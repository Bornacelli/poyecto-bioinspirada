/* ==========================================================================
   simulacion.js — El mundo: hormiguero, comida, obstáculos, feromonas y
   las hormigas. No dibuja nada (eso lo hace interfaz.js); solo calcula.

   Ideas clave:
   - El mundo mide 800 × 500 "píxeles". Las feromonas viven en una
     cuadrícula de 200 × 125 celdas (cada celda = 4 píxeles).
   - Hay DOS mapas de feromona: "hogar" (la dejan las hormigas que buscan
     comida, para poder volver) y "comida" (la dejan las que regresan
     cargadas, para que otras encuentren la fuente).
   - Cada "paso" de simulación equivale a 1/30 de segundo simulado.
   ========================================================================== */
(function (global) {
  'use strict';

  const Cerebro = (typeof module !== 'undefined' && module.exports) ? require('./cerebro.js') : global.Cerebro;

  /* ---------------- Constantes del mundo ---------------- */
  const CELDA = 4;                 // píxeles por celda de feromona
  const COLS = 200, FILAS = 125;   // tamaño de la cuadrícula
  const ANCHO = COLS * CELDA;      // 800
  const ALTO = FILAS * CELDA;      // 500
  const N = COLS * FILAS;
  const PASOS_POR_SEG = 30;        // 30 pasos = 1 segundo simulado
  const INTERVALO_MUESTRA = 5;     // cada cuántos segundos simulados se guarda una muestra

  /* ---------------- Constantes de las hormigas ---------------- */
  const VELOCIDAD = 2;             // píxeles por paso
  const DIST_SENSOR = 14;          // a qué distancia "huelen" hacia adelante
  const ANG_SENSOR = 0.6;          // ángulo (rad) de los sensores laterales
  const GIRO = 0.3;                // cuánto giran (rad) al decidir girar
  const DEPOSITO = 0.5;            // cantidad de feromona que dejan por paso
  const DECAE_RESERVA = 0.996;     // la "reserva" de feromona baja con el tiempo → forma un gradiente
  const MAX_FER = 5;               // tope de feromona por celda
  const RADIO_NIDO = 14;           // radio del hormiguero
  const OLFATO_COMIDA = 30;        // distancia a la que huelen la comida directamente
  const OLFATO_NIDO = 45;          // distancia a la que "reconocen" su nido
  const K_DIFUSION = 0.12;         // cuánto se esparce la feromona a las celdas vecinas
  const VENTANA_RUTA = 60;         // nº de cruces recientes usados para el % de ruta corta

  /* ---------------- Utilidades ---------------- */
  function radioFuente(cant) {
    return Math.min(22, 5 + Math.sqrt(Math.max(cant, 0)) * 0.35);
  }

  // Lee la feromona alrededor de un punto (promedio de 5 celdas en cruz)
  // y la comprime a un valor entre 0 y 1.
  function leer(campo, x, y) {
    const cx = (x / CELDA) | 0, cy = (y / CELDA) | 0;
    if (cx < 1 || cy < 1 || cx >= COLS - 1 || cy >= FILAS - 1) return 0;
    const i = cy * COLS + cx;
    const m = (campo[i] + campo[i - 1] + campo[i + 1] + campo[i - COLS] + campo[i + COLS]) * 0.2;
    return m / (m + 0.5);
  }

  // Gira un ángulo `a` un poco hacia el ángulo `objetivo` (por el camino corto).
  function girarHacia(a, objetivo, fuerza) {
    let d = objetivo - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * fuerza;
  }

  /* ======================================================================
     ESCENARIOS PREDEFINIDOS
     `montar` coloca nido, comida y muros. `programados` son cambios que
     ocurren solos a cierto segundo simulado.
     ====================================================================== */
  const ESCENARIOS = {
    basico: {
      nombre: 'Básico',
      descripcion: 'Un hormiguero y una sola fuente de comida. Mira cómo aparece un camino de feromonas.',
      montar(m) {
        m.nido = { x: 130, y: 250 };
        m.agregarFuente(660, 300, 2500);
      },
    },
    dosCaminos: {
      nombre: 'Dos caminos',
      descripcion: 'Experimento del puente doble: dos rutas hacia la misma comida, la de arriba corta y la de abajo larga. Se mide qué % de hormigas usa la corta.',
      montar(m) {
        m.nido = { x: 90, y: 230 };
        m.agregarFuente(710, 230, 4000);
        m.rectMuro(200, 0, 600, 120, 1);   // bloque superior
        m.rectMuro(200, 220, 600, 420, 1); // isla central: deja un pasillo arriba (corto) y otro abajo (largo)
        m.dosCaminos = { xMedio: 400, yMedio: 300 }; // y < 300 = ruta corta (arriba)
      },
    },
    obstaculo: {
      nombre: 'Obstáculo',
      descripcion: 'La colonia establece su ruta recta. A los 2:30 aparece un muro en medio y debe encontrar un rodeo.',
      montar(m) {
        m.nido = { x: 110, y: 250 };
        m.agregarFuente(690, 250, 4000);
        m.programados.push({
          t: 150,
          etiqueta: 'Aparece un muro',
          aplicar(mm) { mm.rectMuro(385, 130, 415, 370, 1); },
        });
      },
    },
    comidaMovil: {
      nombre: 'Comida que se mueve',
      descripcion: 'A los 2:30 la fuente de comida cambia de lugar. Las hormigas deben abandonar el rastro viejo y descubrir el nuevo.',
      montar(m) {
        m.nido = { x: 130, y: 350 };
        m.agregarFuente(680, 120, 4000);
        m.programados.push({
          t: 150,
          etiqueta: 'La comida cambia de lugar',
          aplicar(mm) { mm.fuentes = []; mm.agregarFuente(640, 420, 4000); },
        });
      },
    },
    variasFuentes: {
      nombre: 'Varias fuentes',
      descripcion: 'Tres fuentes a distinta distancia. Las cercanas se agotan primero y la colonia pasa a las siguientes.',
      montar(m) {
        m.nido = { x: 120, y: 250 };
        m.agregarFuente(260, 120, 500);
        m.agregarFuente(480, 390, 700);
        m.agregarFuente(710, 170, 900);
      },
    },
  };

  /* ======================================================================
     MUNDO
     ====================================================================== */
  class Mundo {
    constructor(params) {
      this.params = Object.assign({ hormigas: 100, evaporacion: 0.3, exploracion: 0.4 }, params);
      // Dos mapas de feromona; cada uno con un arreglo auxiliar para la difusión.
      this.hogar = new Float32Array(N);
      this.hogarB = new Float32Array(N);
      this.comida = new Float32Array(N);
      this.comidaB = new Float32Array(N);
      this.muros = new Uint8Array(N);
      this.escenario = 'basico';
      this.cargarEscenario('basico');
    }

    /* ---------- Preparación ---------- */
    cargarEscenario(id) {
      this.escenario = id;
      this.hogar.fill(0); this.hogarB.fill(0);
      this.comida.fill(0); this.comidaB.fill(0);
      this.muros.fill(0);
      this.murosVersion = 0;
      this.fuentes = [];
      this.programados = [];
      this.dosCaminos = null;
      this.hormigas = [];
      this.seleccionada = null;
      this.infoSel = null;
      // estadísticas
      this.pasos = 0;
      this.total = 0;
      this.entregas = [];        // segundos simulados en que se entregó comida
      this.primeraComida = null; // segundo en que se tocó comida por primera vez
      this.eventos = [];
      this.muestras = [];
      this.cruces = [];

      ESCENARIOS[id].montar(this);
      this.programados.sort((a, b) => a.t - b.t);
      this.ajustarHormigas(this.params.hormigas);
      this.muestrear();
    }

    reiniciar() { this.cargarEscenario(this.escenario); }

    get t() { return this.pasos / PASOS_POR_SEG; }

    nuevaHormiga() {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * RADIO_NIDO;
      return {
        x: this.nido.x + Math.cos(a) * r,
        y: this.nido.y + Math.sin(a) * r,
        ang: Math.random() * Math.PI * 2,
        lleva: false,
        res: 1, // reserva de feromona: 1 = recién salió del nido/comida
      };
    }

    ajustarHormigas(n) {
      this.params.hormigas = n;
      while (this.hormigas.length < n) this.hormigas.push(this.nuevaHormiga());
      if (this.hormigas.length > n) {
        this.hormigas.length = n;
        if (this.seleccionada && this.hormigas.indexOf(this.seleccionada) < 0) {
          this.seleccionada = null; this.infoSel = null;
        }
      }
    }

    seleccionarCerca(x, y) {
      let mejor = null, md = 18 * 18;
      for (const a of this.hormigas) {
        const d = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
        if (d < md) { md = d; mejor = a; }
      }
      this.seleccionada = mejor;
      this.infoSel = null;
      return mejor;
    }

    /* ---------- Edición del entorno ---------- */
    agregarFuente(x, y, cant) {
      this.fuentes.push({ x, y, cant, r: radioFuente(cant) });
    }

    // Pone (val=1) o quita (val=0) muro en un rectángulo dado en píxeles.
    rectMuro(x0, y0, x1, y1, val) {
      const cx0 = Math.max(0, (x0 / CELDA) | 0), cx1 = Math.min(COLS - 1, ((x1 - 1) / CELDA) | 0);
      const cy0 = Math.max(0, (y0 / CELDA) | 0), cy1 = Math.min(FILAS - 1, ((y1 - 1) / CELDA) | 0);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const i = cy * COLS + cx;
          this.muros[i] = val;
          if (val) { this.hogar[i] = 0; this.comida[i] = 0; }
        }
      }
      this.murosVersion++;
    }

    // Pincel circular. Devuelve true si algo cambió. No pinta sobre el nido ni la comida.
    pintarMuros(x, y, r, val) {
      let cambio = false;
      const cx0 = Math.max(0, ((x - r) / CELDA) | 0), cx1 = Math.min(COLS - 1, ((x + r) / CELDA) | 0);
      const cy0 = Math.max(0, ((y - r) / CELDA) | 0), cy1 = Math.min(FILAS - 1, ((y + r) / CELDA) | 0);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = cx * CELDA + CELDA / 2, py = cy * CELDA + CELDA / 2;
          if ((px - x) * (px - x) + (py - y) * (py - y) > r * r) continue;
          if (val) {
            if (Math.hypot(px - this.nido.x, py - this.nido.y) < RADIO_NIDO + 10) continue;
            if (this.fuentes.some(f => Math.hypot(px - f.x, py - f.y) < f.r + 6)) continue;
          }
          const i = cy * COLS + cx;
          if (this.muros[i] !== val) {
            this.muros[i] = val; cambio = true;
            if (val) { this.hogar[i] = 0; this.comida[i] = 0; }
          }
        }
      }
      if (cambio) this.murosVersion++;
      return cambio;
    }

    borrarFuentesCerca(x, y, r) {
      const antes = this.fuentes.length;
      this.fuentes = this.fuentes.filter(f => Math.hypot(f.x - x, f.y - y) > f.r + r);
      return this.fuentes.length !== antes;
    }

    esMuro(x, y) {
      const cx = (x / CELDA) | 0, cy = (y / CELDA) | 0;
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= FILAS) return true;
      return this.muros[cy * COLS + cx] === 1;
    }

    /* ---------- Indicadores ---------- */
    registrarEvento(etiqueta) {
      this.eventos.push({
        t: this.t, etiqueta,
        base: this.tasa(60),   // recolección "de antes" (comida/min en el último minuto)
        dip: false,            // ¿ya cayó por debajo del 80 %?
        rec: null,             // segundos hasta volver al 80 %
        estado: 'midiendo',    // midiendo | ok | sin_caida | nd
      });
    }

    // Comida por minuto, calculada con las entregas de los últimos `ventana` segundos.
    tasa(ventana) {
      const t = this.t;
      const v = Math.min(ventana, t);
      if (v <= 0) return 0;
      let c = 0;
      for (let i = this.entregas.length - 1; i >= 0 && this.entregas[i] > t - v; i--) c++;
      return c * 60 / v;
    }

    pctRutaCorta() {
      if (!this.dosCaminos || this.cruces.length < 5) return null;
      let s = 0;
      for (const c of this.cruces) s += c;
      return 100 * s / this.cruces.length;
    }

    // Se llama una vez por segundo simulado: revisa la recuperación tras cada cambio.
    cadaSegundo() {
      const t = this.t;
      for (const ev of this.eventos) {
        if (ev.estado !== 'midiendo') continue;
        if (ev.base <= 0) { ev.estado = 'nd'; continue; }
        const r = this.tasa(30);
        if (!ev.dip && r < 0.8 * ev.base) ev.dip = true;
        if (ev.dip && r >= 0.8 * ev.base) { ev.rec = t - ev.t; ev.estado = 'ok'; }
        else if (!ev.dip && t - ev.t > 90) { ev.rec = 0; ev.estado = 'sin_caida'; }
      }
      if (this.pasos % (INTERVALO_MUESTRA * PASOS_POR_SEG) === 0) this.muestrear();
    }

    muestrear() {
      let busca = 0, lleva = 0;
      for (const a of this.hormigas) { if (a.lleva) lleva++; else busca++; }
      const previo = this.muestras.length ? this.muestras[this.muestras.length - 1].total : 0;
      this.muestras.push({
        t: this.t,
        total: this.total,
        intervalo: this.total - previo,
        porMin: this.tasa(30),
        pctCorta: this.pctRutaCorta(),
        buscando: busca, llevando: lleva,
        hormigas: this.hormigas.length,
        evaporacion: this.params.evaporacion,
        exploracion: this.params.exploracion,
      });
    }

    /* ======================================================================
       UN PASO DE SIMULACIÓN
       ====================================================================== */
    paso() {
      const t = this.t;

      // 1) Cambios programados del escenario (muro que aparece, comida que se mueve…)
      while (this.programados.length && this.programados[0].t <= t) {
        const ev = this.programados.shift();
        ev.aplicar(this);
        this.registrarEvento(ev.etiqueta);
      }

      // Parámetros de exploración (0 a 1) → intensidad del azar y "temperatura" del softmax
      const expl = this.params.exploracion;
      const escalaAzar = 0.3 + 1.7 * expl;
      const temperatura = 0.5 + expl;

      const ent = this._ent || (this._ent = [0, 0, 0, 0, 0]);
      const nido = this.nido;
      const fuentes = this.fuentes;
      const dc = this.dosCaminos;
      let agotada = false;

      for (let h = 0, nh = this.hormigas.length; h < nh; h++) {
        const a = this.hormigas[h];
        const lleva = a.lleva;

        // 2) SENTIR: lee el mapa que le corresponde según su estado
        const campo = lleva ? this.hogar : this.comida;
        const ai = a.ang - ANG_SENSOR, ad = a.ang + ANG_SENSOR;
        ent[0] = leer(campo, a.x + Math.cos(ai) * DIST_SENSOR, a.y + Math.sin(ai) * DIST_SENSOR);
        ent[1] = leer(campo, a.x + Math.cos(a.ang) * DIST_SENSOR, a.y + Math.sin(a.ang) * DIST_SENSOR);
        ent[2] = leer(campo, a.x + Math.cos(ad) * DIST_SENSOR, a.y + Math.sin(ad) * DIST_SENSOR);
        ent[3] = lleva ? 1 : 0;
        ent[4] = (Math.random() * 2 - 1) * escalaAzar;

        // 3) DECIDIR con la red neuronal y girar
        const sel = a === this.seleccionada;
        const accion = Cerebro.decidir(ent, temperatura, sel);
        if (accion === 0) a.ang -= GIRO;
        else if (accion === 2) a.ang += GIRO;
        a.ang += (Math.random() - 0.5) * 0.1; // pequeño temblor natural
        if (sel) {
          this.infoSel = {
            entradas: Cerebro.ultimo.entradas.slice(),
            oculta: Cerebro.ultimo.oculta.slice(),
            probs: Cerebro.ultimo.probs.slice(),
            accion: Cerebro.ultimo.accion,
            lleva,
          };
        }

        // Olfato directo (simplificación): si la comida o el nido están muy cerca, se orientan hacia ellos.
        if (!lleva) {
          for (let i = 0; i < fuentes.length; i++) {
            const f = fuentes[i];
            const dx = f.x - a.x, dy = f.y - a.y;
            if (dx * dx + dy * dy < (f.r + OLFATO_COMIDA) * (f.r + OLFATO_COMIDA)) {
              a.ang = girarHacia(a.ang, Math.atan2(dy, dx), 0.35);
              break;
            }
          }
        } else {
          const dx = nido.x - a.x, dy = nido.y - a.y;
          if (dx * dx + dy * dy < OLFATO_NIDO * OLFATO_NIDO) a.ang = girarHacia(a.ang, Math.atan2(dy, dx), 0.35);
        }

        // 4) MOVER (rebota si choca con un muro o con el borde)
        const px = a.x;
        const nx = a.x + Math.cos(a.ang) * VELOCIDAD;
        const ny = a.y + Math.sin(a.ang) * VELOCIDAD;
        if (nx < 1 || ny < 1 || nx >= ANCHO - 1 || ny >= ALTO - 1 || (this.esMuro(nx, ny) && !this.esMuro(a.x, a.y))) {
          a.ang += (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + Math.random() * 0.9); // gira ~90° para bordear el muro
          continue;
        }
        a.x = nx; a.y = ny;

        // Estadística del puente doble: ¿por cuál ruta cruzó la mitad del mundo?
        if (dc && ((px < dc.xMedio) !== (nx < dc.xMedio))) {
          this.cruces.push(ny < dc.yMedio ? 1 : 0);
          if (this.cruces.length > VENTANA_RUTA) this.cruces.shift();
        }

        // 5) DEJAR FEROMONA: "comida" si va cargada, "hogar" si busca
        const idx = ((ny / CELDA) | 0) * COLS + ((nx / CELDA) | 0);
        const dep = lleva ? this.comida : this.hogar;
        const v = dep[idx] + DEPOSITO * a.res;
        dep[idx] = v > MAX_FER ? MAX_FER : v;
        a.res *= DECAE_RESERVA;
        if (a.res < 0.03) a.res = 0.03;

        // 6) INTERACTUAR con comida y nido
        if (!lleva) {
          for (let i = 0; i < fuentes.length; i++) {
            const f = fuentes[i];
            const dx = f.x - nx, dy = f.y - ny;
            if (f.cant > 0 && dx * dx + dy * dy < (f.r + 3) * (f.r + 3)) {
              f.cant--;
              f.r = radioFuente(f.cant);
              if (f.cant <= 0) agotada = true;
              a.lleva = true; a.res = 1; a.ang += Math.PI;
              if (this.primeraComida === null) this.primeraComida = t;
              break;
            }
          }
          const dxn = nido.x - nx, dyn = nido.y - ny;
          if (dxn * dxn + dyn * dyn < RADIO_NIDO * RADIO_NIDO) a.res = 1; // "recarga" en el nido
        } else {
          const dxn = nido.x - nx, dyn = nido.y - ny;
          if (dxn * dxn + dyn * dyn < RADIO_NIDO * RADIO_NIDO) {
            a.lleva = false; a.res = 1; a.ang += Math.PI;
            this.total++;
            this.entregas.push(t);
          }
        }
      }

      // Las fuentes agotadas desaparecen
      if (agotada) this.fuentes = this.fuentes.filter(f => f.cant > 0);

      // 7) Evaporación y difusión (una vez cada 2 pasos, con el doble de efecto)
      if ((this.pasos & 1) === 0) {
        const e = this.params.evaporacion / 100;
        let r = this.difundir(this.comida, this.comidaB, 2 * e);
        this.comidaB = this.comida; this.comida = r;
        // El rastro de "hogar" se evapora a la mitad de velocidad para que siempre se pueda volver.
        r = this.difundir(this.hogar, this.hogarB, e);
        this.hogarB = this.hogar; this.hogar = r;
      }

      this.pasos++;
      if (this.pasos % PASOS_POR_SEG === 0) this.cadaSegundo();
    }

    // Esparce un poco la feromona hacia las celdas vecinas y la hace evaporar.
    // Escribe el resultado en `dest` y lo devuelve.
    difundir(src, dest, evap) {
      const f = 1 - evap;
      const muros = this.muros;
      for (let y = 1; y < FILAS - 1; y++) {
        let i = y * COLS + 1;
        for (let x = 1; x < COLS - 1; x++, i++) {
          const v = src[i];
          const prom = (src[i - 1] + src[i + 1] + src[i - COLS] + src[i + COLS]) * 0.25;
          let r = (v + K_DIFUSION * (prom - v)) * f;
          if (r < 0.0008 || muros[i] === 1) r = 0;
          dest[i] = r;
        }
      }
      return dest;
    }
  }

  const Simulacion = {
    Mundo, ESCENARIOS,
    CELDA, COLS, FILAS, ANCHO, ALTO, PASOS_POR_SEG, INTERVALO_MUESTRA, RADIO_NIDO,
    ANG_SENSOR, DIST_SENSOR,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Simulacion;
  else global.Simulacion = Simulacion;
})(typeof window !== 'undefined' ? window : globalThis);
