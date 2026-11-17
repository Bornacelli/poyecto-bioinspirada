/* ==========================================================================
   cerebro.js — La "mente" de cada hormiga: una red neuronal muy pequeña.

   Estructura (5 → 4 → 3):
     5 entradas  →  4 neuronas ocultas (tanh)  →  3 salidas (softmax)

   Los pesos NO se entrenan: están fijos y los elegí a mano para que la red
   se comporte como una hormiga real (seguir el rastro más fuerte, pero
   explorar de vez en cuando). Cada peso está explicado abajo.
   ========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------------
     ENTRADAS (todas entre 0 y 1, salvo el azar que va de -1 a 1)
       e0  izq    : feromona detectada por el sensor izquierdo
       e1  cen    : feromona detectada por el sensor central
       e2  der    : feromona detectada por el sensor derecho
       e3  lleva  : 1 si lleva comida, 0 si no
       e4  azar   : número aleatorio (da la "curiosidad" o exploración)
     La hormiga lee la feromona de COMIDA si está buscando, y la de HOGAR
     si regresa al nido (eso lo decide simulacion.js antes de llamar aquí).
     -------------------------------------------------------------------- */
  const ETIQ_ENTRADAS = ['Sensor izq.', 'Sensor centro', 'Sensor der.', 'Lleva comida', 'Azar'];
  const ETIQ_OCULTA = ['Rastro a la izq.', 'Rastro al centro', 'Impulso al azar', 'Rumbo decidido'];
  const ETIQ_SALIDAS = ['Girar izquierda', 'Seguir recto', 'Girar derecha'];

  /* --------------------------------------------------------------------
     CAPA OCULTA: cada fila es una neurona; cada columna, una entrada
     (orden: izq, centro, der, lleva, azar). Se calcula tanh(W·e + b).
     -------------------------------------------------------------------- */
  const W1 = [
    // N0 "Rastro a la izquierda": se activa (+) si hay MÁS feromona a la
    //    izquierda que a la derecha, y se vuelve negativa en el caso contrario.
    //    Es la resta izq - der, amplificada ×6 para notar rastros débiles.
    [6, 0, -6, 0, 0],

    // N1 "Rastro al centro": se activa si el sensor central supera a los
    //    laterales (+6 al centro, -3 a cada lado). Indica "el camino sigue recto".
    [-3, 6, -3, 0, 0],

    // N2 "Impulso al azar": solo mira el número aleatorio (×2.5).
    //    Si sale positivo empuja a girar a la derecha; si sale negativo, a la izquierda.
    [0, 0, 0, 0, 2.5],

    // N3 "Rumbo decidido": suma de cualquier feromona detectada y de llevar
    //    comida. Con rastro o con carga la hormiga se vuelve más "decidida"
    //    y prefiere avanzar recto en vez de dar vueltas.
    [1, 1.5, 1, 1.5, 0],
  ];
  const B1 = [0, 0, 0, -0.5]; // el sesgo -0.5 de N3: sin estímulos, no hay "rumbo decidido"

  /* --------------------------------------------------------------------
     CAPA DE SALIDA: una fila por acción (izq, recto, der); una columna
     por neurona oculta (N0, N1, N2, N3). Se calcula W·h + b y luego softmax.
     -------------------------------------------------------------------- */
  const W2 = [
    // Girar izquierda: la favorece el rastro a la izquierda (+2.2) y el
    //    impulso aleatorio NEGATIVO (-1.6 × valor negativo = positivo).
    [2.2, 0, -1.6, 0],

    // Seguir recto: lo favorece el rastro al centro (+2) y el rumbo decidido (+0.8).
    [0, 2.0, 0, 0.8],

    // Girar derecha: espejo de la izquierda.
    [-2.2, 0, 1.6, 0],
  ];
  // Sesgo: recto parte con ventaja (+0.6) —las hormigas no zigzaguean sin motivo—
  // y los giros con -0.2 para que no giren sin razón.
  const B2 = [-0.2, 0.6, -0.2];

  /* Última decisión guardada (se usa para dibujar la red de la hormiga seleccionada). */
  const ultimo = {
    entradas: [0, 0, 0, 0, 0],
    oculta: [0, 0, 0, 0],
    logits: [0, 0, 0],
    probs: [1 / 3, 1 / 3, 1 / 3],
    accion: 1,
  };

  // Arreglos de trabajo reutilizados (evitan crear basura en cada decisión).
  const h = [0, 0, 0, 0];
  const z = [0, 0, 0];
  const p = [0, 0, 0];

  /**
   * decidir: recibe las 5 entradas y devuelve 0 (izq), 1 (recto) o 2 (der).
   * @param {number[]} e            entradas [izq, centro, der, lleva, azar]
   * @param {number}   temperatura  >1 = más impredecible, <1 = más seguro (softmax)
   * @param {boolean}  guardar      si es true, deja los detalles en `ultimo`
   */
  function decidir(e, temperatura, guardar) {
    // 1) Capa oculta: tanh(W1·e + b1)
    for (let j = 0; j < 4; j++) {
      const w = W1[j];
      h[j] = Math.tanh(w[0] * e[0] + w[1] * e[1] + w[2] * e[2] + w[3] * e[3] + w[4] * e[4] + B1[j]);
    }
    // 2) Capa de salida: W2·h + b2
    for (let k = 0; k < 3; k++) {
      const w = W2[k];
      z[k] = w[0] * h[0] + w[1] * h[1] + w[2] * h[2] + w[3] * h[3] + B2[k];
    }
    // 3) Softmax con temperatura (se resta el máximo para evitar desbordes)
    const m = Math.max(z[0], z[1], z[2]);
    const e0 = Math.exp((z[0] - m) / temperatura);
    const e1 = Math.exp((z[1] - m) / temperatura);
    const e2 = Math.exp((z[2] - m) / temperatura);
    const s = e0 + e1 + e2;
    p[0] = e0 / s; p[1] = e1 / s; p[2] = e2 / s;

    // 4) Se elige al azar según esas probabilidades
    const r = Math.random();
    const accion = r < p[0] ? 0 : (r < p[0] + p[1] ? 1 : 2);

    if (guardar) {
      for (let i = 0; i < 5; i++) ultimo.entradas[i] = e[i];
      for (let i = 0; i < 4; i++) ultimo.oculta[i] = h[i];
      for (let i = 0; i < 3; i++) { ultimo.logits[i] = z[i]; ultimo.probs[i] = p[i]; }
      ultimo.accion = accion;
    }
    return accion;
  }

  const Cerebro = { ETIQ_ENTRADAS, ETIQ_OCULTA, ETIQ_SALIDAS, W1, B1, W2, B2, ultimo, decidir };

  if (typeof module !== 'undefined' && module.exports) module.exports = Cerebro;
  else global.Cerebro = Cerebro;
})(typeof window !== 'undefined' ? window : globalThis);
