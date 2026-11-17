/* ==========================================================================
   interfaz.js — Conecta la simulación con la página: dibuja el mundo,
   maneja los controles, muestra los indicadores, el gráfico y el CSV.
   ========================================================================== */
(function () {
  'use strict';

  const S = Simulacion;
  const $ = id => document.getElementById(id);

  /* ---------------- Elementos de la página ---------------- */
  const lienzo = $('lienzo');
  const ctx = lienzo.getContext('2d');
  const lienzoRed = $('lienzoRed');
  const ctxRed = lienzoRed.getContext('2d');
  const grafico = $('grafico');

  // Mini-lienzo donde se pinta el mapa de feromonas (1 píxel = 1 celda) y luego se amplía.
  const mapaFer = document.createElement('canvas');
  mapaFer.width = S.COLS; mapaFer.height = S.FILAS;
  const ctxFer = mapaFer.getContext('2d');
  const imgFer = ctxFer.createImageData(S.COLS, S.FILAS);

  // Otro mini-lienzo para los muros (solo se redibuja cuando cambian).
  const mapaMuros = document.createElement('canvas');
  mapaMuros.width = S.COLS; mapaMuros.height = S.FILAS;
  const ctxMuros = mapaMuros.getContext('2d');
  const imgMuros = ctxMuros.createImageData(S.COLS, S.FILAS);
  let versionMurosDibujada = -1;

  /* ---------------- Estado de la interfaz ---------------- */
  let escenarioActual = 'basico';
  let corriendo = false;
  let acumulador = 0;          // pasos pendientes (permite velocidades fraccionarias)
  let modo = 'seleccionar';
  let trazando = false;        // ¿el usuario está arrastrando con obstáculo/borrar?
  let trazoMarcado = false;    // ¿este trazo ya se registró como cambio del entorno?
  let ultimoRefresco = 0;
  let muestrasDibujadas = -1;
  let eventosDibujados = -1;

  const mundo = new S.Mundo(leerParametros());

  function leerParametros() {
    return {
      hormigas: +$('sHormigas').value,
      evaporacion: +$('sEvap').value,
      exploracion: +$('sExpl').value / 100,
    };
  }
  const velocidad = () => +$('sVel').value;

  /* ======================================================================
     CONTROLES
     ====================================================================== */
  function formatoTiempo(seg) {
    const s = Math.floor(seg);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fijarCorriendo(v) {
    corriendo = v;
    $('btnIniciar').disabled = v;
    $('btnPausar').disabled = !v;
    $('btnIniciar').textContent = (!v && mundo.pasos > 0) ? '▶ Continuar' : '▶ Iniciar';
  }

  function cargarEscenario(id) {
    escenarioActual = id;
    Object.assign(mundo.params, leerParametros());
    mundo.cargarEscenario(id);
    fijarCorriendo(false);
    document.querySelectorAll('.esc').forEach(b => b.classList.toggle('activo', b.dataset.esc === id));
    $('descEscenario').textContent = S.ESCENARIOS[id].descripcion;
    muestrasDibujadas = -1; eventosDibujados = -1;
    versionMurosDibujada = -1;
    actualizarIndicadores();
    dibujarTodo();
  }

  $('btnIniciar').addEventListener('click', () => fijarCorriendo(true));
  $('btnPausar').addEventListener('click', () => fijarCorriendo(false));
  $('btnReiniciar').addEventListener('click', () => cargarEscenario(escenarioActual));
  document.querySelectorAll('.esc').forEach(b => b.addEventListener('click', () => cargarEscenario(b.dataset.esc)));

  // Deslizadores: actualizan el número mostrado y aplican el valor en vivo.
  $('sHormigas').addEventListener('input', e => {
    $('vHormigas').textContent = e.target.value;
    mundo.ajustarHormigas(+e.target.value);
    dibujarTodo();
  });
  $('sEvap').addEventListener('input', e => {
    $('vEvap').textContent = (+e.target.value).toFixed(2);
    mundo.params.evaporacion = +e.target.value;
  });
  $('sExpl').addEventListener('input', e => {
    $('vExpl').textContent = e.target.value;
    mundo.params.exploracion = +e.target.value / 100;
  });
  $('sVel').addEventListener('input', e => { $('vVel').textContent = e.target.value; });

  document.querySelectorAll('input[name="modo"]').forEach(r => r.addEventListener('change', () => {
    modo = r.value;
    if (!r.checked) return;
    lienzo.classList.toggle('dibujando', modo !== 'seleccionar');
  }));
  $('chkFer').addEventListener('change', dibujarTodo);
  $('chkRed').addEventListener('change', () => {
    $('panelRed').hidden = !$('chkRed').checked;
    if ($('chkRed').checked && !mundo.seleccionada && mundo.hormigas.length) {
      mundo.seleccionada = mundo.hormigas[0]; // para que haya algo que ver desde el inicio
      mundo.infoSel = null;
    }
    dibujarTodo();
  });

  /* ---------- Interacción con el mapa (clic / arrastrar) ---------- */
  function posicion(e) {
    const r = lienzo.getBoundingClientRect();
    return { x: (e.clientX - r.left) * S.ANCHO / r.width, y: (e.clientY - r.top) * S.ALTO / r.height };
  }

  // Cada cambio hecho por el usuario después de iniciar cuenta como "cambio del entorno".
  function marcarCambio(texto) { if (mundo.pasos > 0) mundo.registrarEvento(texto); }

  function aplicarHerramienta(p) {
    let cambio = false, texto = '';
    if (modo === 'comida') {
      if (trazoMarcado) return;       // la comida se pone solo con el clic inicial
      mundo.agregarFuente(p.x, p.y, 400);
      cambio = true; texto = 'Se añadió comida';
    } else if (modo === 'obstaculo') {
      cambio = mundo.pintarMuros(p.x, p.y, 12, 1); texto = 'Se dibujó un obstáculo';
    } else if (modo === 'borrar') {
      const a = mundo.pintarMuros(p.x, p.y, 14, 0);
      const b = mundo.borrarFuentesCerca(p.x, p.y, 8);
      cambio = a || b; texto = 'Se borró parte del entorno';
    }
    // Un trazo completo (clic o arrastre) cuenta como un solo cambio del entorno.
    if (cambio && !trazoMarcado) { trazoMarcado = true; marcarCambio(texto); }
  }

  lienzo.addEventListener('pointerdown', e => {
    const p = posicion(e);
    if (modo === 'seleccionar') {
      const a = mundo.seleccionarCerca(p.x, p.y);
      if (a && !$('chkRed').checked) { $('chkRed').checked = true; $('panelRed').hidden = false; }
      dibujarTodo();
      return;
    }
    trazando = true;
    trazoMarcado = false;
    lienzo.setPointerCapture(e.pointerId);
    aplicarHerramienta(p);
    dibujarTodo();
  });
  lienzo.addEventListener('pointermove', e => {
    if (!trazando || (modo !== 'obstaculo' && modo !== 'borrar')) return;
    aplicarHerramienta(posicion(e));
    if (!corriendo) dibujarTodo();
  });
  const finTrazo = () => { trazando = false; };
  lienzo.addEventListener('pointerup', finTrazo);
  lienzo.addEventListener('pointercancel', finTrazo);

  /* ======================================================================
     BUCLE PRINCIPAL
     ====================================================================== */
  function bucle(ts) {
    if (corriendo) {
      acumulador += velocidad();
      const limite = performance.now() + 14; // no gastar más de ~14 ms por cuadro
      while (acumulador >= 1) {
        mundo.paso();
        acumulador -= 1;
        if (performance.now() > limite) { acumulador = 0; break; }
      }
    }
    dibujarTodo();
    if (ts - ultimoRefresco > 200) { ultimoRefresco = ts; actualizarIndicadores(); }
    requestAnimationFrame(bucle);
  }

  /* ======================================================================
     DIBUJO DEL MUNDO
     ====================================================================== */
  const COLOR_HOGAR = [37, 99, 235];
  const COLOR_COMIDA = [234, 88, 12];

  function dibujarFeromonas() {
    const d = imgFer.data, h = mundo.hogar, c = mundo.comida;
    for (let i = 0, j = 0; i < h.length; i++, j += 4) {
      const a1 = h[i] / (h[i] + 1.2);   // intensidad visible de "hogar" (0 a 1)
      const a2 = c[i] / (c[i] + 1.2);   // intensidad visible de "comida"
      const s = a1 + a2;
      if (s < 0.02) { d[j + 3] = 0; continue; }
      d[j] = (COLOR_HOGAR[0] * a1 + COLOR_COMIDA[0] * a2) / s;
      d[j + 1] = (COLOR_HOGAR[1] * a1 + COLOR_COMIDA[1] * a2) / s;
      d[j + 2] = (COLOR_HOGAR[2] * a1 + COLOR_COMIDA[2] * a2) / s;
      d[j + 3] = Math.min(215, s * 330);
    }
    ctxFer.putImageData(imgFer, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapaFer, 0, 0, S.ANCHO, S.ALTO);
  }

  function dibujarMuros() {
    if (versionMurosDibujada !== mundo.murosVersion) {
      const d = imgMuros.data, m = mundo.muros;
      for (let i = 0, j = 0; i < m.length; i++, j += 4) {
        if (m[i]) { d[j] = 85; d[j + 1] = 96; d[j + 2] = 110; d[j + 3] = 255; } else d[j + 3] = 0;
      }
      ctxMuros.putImageData(imgMuros, 0, 0);
      versionMurosDibujada = mundo.murosVersion;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapaMuros, 0, 0, S.ANCHO, S.ALTO);
  }

  function dibujarTodo() {
    ctx.fillStyle = '#faf8f3';
    ctx.fillRect(0, 0, S.ANCHO, S.ALTO);

    if ($('chkFer').checked) dibujarFeromonas();
    dibujarMuros();

    // Fuentes de comida
    for (const f of mundo.fuentes) {
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832);
      ctx.fillStyle = '#3f8f4f'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#2b6a38'; ctx.stroke();
    }

    // Nido
    const n = mundo.nido;
    ctx.beginPath(); ctx.arc(n.x, n.y, S.RADIO_NIDO + 3, 0, 6.2832);
    ctx.fillStyle = '#7a4b2a'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#4e2f19'; ctx.stroke();
    ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, 6.2832); ctx.fillStyle = '#3a2412'; ctx.fill();

    // Hormigas: las que buscan en gris oscuro; las que cargan comida, con un punto verde.
    ctx.fillStyle = '#2d2a26';
    for (const a of mundo.hormigas) ctx.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
    ctx.fillStyle = '#4fbf5f';
    for (const a of mundo.hormigas) if (a.lleva) ctx.fillRect(a.x - 1, a.y - 1, 2.2, 2.2);

    // Hormiga seleccionada y sus sensores
    const s = mundo.seleccionada;
    if (s) {
      ctx.strokeStyle = '#d6336c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, 6.2832); ctx.stroke();
      ctx.lineWidth = 1;
      for (const da of [-S.ANG_SENSOR, 0, S.ANG_SENSOR]) {
        const sx = s.x + Math.cos(s.ang + da) * S.DIST_SENSOR, sy = s.y + Math.sin(s.ang + da) * S.DIST_SENSOR;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, 2, 0, 6.2832); ctx.fillStyle = '#d6336c'; ctx.fill();
      }
    }

    $('reloj').textContent = formatoTiempo(mundo.t);
    if (!$('panelRed').hidden) dibujarRed();

    if (muestrasDibujadas !== mundo.muestras.length || eventosDibujados !== mundo.eventos.length) {
      muestrasDibujadas = mundo.muestras.length;
      eventosDibujados = mundo.eventos.length;
      dibujarGrafico();
      listarEventos();
    }
  }

  /* ======================================================================
     VISOR DE LA RED NEURONAL
     ====================================================================== */
  function dibujarRed() {
    const C = Cerebro, g = ctxRed, W = lienzoRed.width, H = lienzoRed.height;
    g.clearRect(0, 0, W, H);
    const sel = mundo.seleccionada, info = mundo.infoSel;
    const txt = $('textoRed');

    if (!sel) { txt.textContent = 'Haz clic sobre una hormiga en el mapa (modo Seleccionar hormiga).'; return; }
    if (!info) { txt.textContent = 'Hormiga seleccionada. Inicia la simulación para ver sus decisiones.'; return; }
    txt.textContent = 'Estado: ' + (info.lleva ? 'regresando al nido (lee feromona de hogar)' : 'buscando comida (lee feromona de comida)') + '.';

    const xE = 150, xO = 330, xS = 470;
    const ys = (n, i) => 40 + (H - 80) * (n === 1 ? 0.5 : i / (n - 1));

    // Conexiones: grosor según el peso; azul = positivo, rojo = negativo
    function conexion(x1, y1, x2, y2, w) {
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
      g.strokeStyle = w >= 0 ? 'rgba(37,99,235,0.5)' : 'rgba(200,50,50,0.5)';
      g.lineWidth = Math.min(4, Math.abs(w) * 0.6) + 0.2; g.stroke();
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) if (C.W1[j][i] !== 0) conexion(xE, ys(5, i), xO, ys(4, j), C.W1[j][i]);
    for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) if (C.W2[k][j] !== 0) conexion(xO, ys(4, j), xS, ys(3, k), C.W2[k][j]);

    function nodo(x, y, v, min, max) {
      const t = (v - min) / (max - min);
      g.beginPath(); g.arc(x, y, 13, 0, 6.2832);
      g.fillStyle = `rgba(61,107,87,${0.12 + 0.88 * Math.max(0, Math.min(1, t))})`; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#3d6b57'; g.stroke();
    }
    g.font = '12.5px system-ui, sans-serif';
    g.textBaseline = 'middle';

    // Entradas
    for (let i = 0; i < 5; i++) {
      const y = ys(5, i);
      nodo(xE, y, info.entradas[i], i === 4 ? -1 : 0, 1);
      g.fillStyle = '#28251f'; g.textAlign = 'right';
      g.fillText(C.ETIQ_ENTRADAS[i] + '  ' + info.entradas[i].toFixed(2), xE - 20, y);
    }
    // Capa oculta
    for (let j = 0; j < 4; j++) {
      const y = ys(4, j);
      nodo(xO, y, info.oculta[j], -1, 1);
      g.fillStyle = '#6b665c'; g.textAlign = 'left';
      g.fillText(info.oculta[j].toFixed(2), xO + 34, y);
    }
    // Salidas con su probabilidad; la elegida va resaltada
    for (let k = 0; k < 3; k++) {
      const y = ys(3, k), elegida = info.accion === k;
      g.beginPath(); g.arc(xS, y, 13, 0, 6.2832);
      g.fillStyle = elegida ? '#d6336c' : `rgba(61,107,87,${0.12 + 0.88 * info.probs[k]})`; g.fill();
      g.lineWidth = elegida ? 3 : 1.5; g.strokeStyle = elegida ? '#a3174a' : '#3d6b57'; g.stroke();
      g.fillStyle = elegida ? '#a3174a' : '#28251f'; g.textAlign = 'left';
      g.font = (elegida ? 'bold ' : '') + '12.5px system-ui, sans-serif';
      g.fillText(C.ETIQ_SALIDAS[k] + '  ' + Math.round(info.probs[k] * 100) + ' %', xS + 20, y);
    }
    g.font = '12px system-ui, sans-serif';
    g.fillStyle = '#6b665c'; g.textAlign = 'center';
    g.fillText('Entradas', xE, 14); g.fillText('Oculta (tanh)', xO, 14); g.fillText('Salidas (softmax)', xS + 40, 14);
    g.textAlign = 'left'; g.fillStyle = '#a3174a'; g.font = 'bold 13px system-ui, sans-serif';
    g.fillText('Decisión: ' + C.ETIQ_SALIDAS[info.accion], 12, H - 12);
  }

  /* ======================================================================
     INDICADORES
     ====================================================================== */
  function textoRecuperacion(ev) {
    if (!ev) return ['—', 'Aún no hay cambios'];
    if (ev.estado === 'ok') return [Math.round(ev.rec) + ' s', 'Tras "' + ev.etiqueta + ''];
    if (ev.estado === 'sin_caida') return ['0 s', 'Sin caída notable tras "' + ev.etiqueta + ''];
    if (ev.estado === 'nd') return ['n/d', 'No había recolección previa'];
    return ['…', 'Midiendo tras "' + ev.etiqueta + ' (' + Math.round(mundo.t - ev.t) + ' s)'];
  }

  function actualizarIndicadores() {
    $('indTotal').textContent = mundo.total;
    $('indPorMin').textContent = mundo.tasa(30).toFixed(0);
    $('indPrimera').textContent = mundo.primeraComida === null ? '—' : mundo.primeraComida.toFixed(1) + ' s';
    const [v, d] = textoRecuperacion(mundo.eventos[mundo.eventos.length - 1]);
    $('indRecup').textContent = v; $('indRecupDet').textContent = d;

    if (mundo.dosCaminos) {
      const p = mundo.pctRutaCorta();
      $('indRuta').textContent = p === null ? '…' : p.toFixed(0) + ' %';
      $('indRutaDet').textContent = 'De los últimos cruces por el centro';
    } else {
      $('indRuta').textContent = '—';
      $('indRutaDet').textContent = 'Solo en Dos caminos';
    }
    let b = 0, l = 0;
    for (const a of mundo.hormigas) { if (a.lleva) l++; else b++; }
    $('indEstados').textContent = b + ' / ' + l;
  }

  /* ======================================================================
     GRÁFICO (dibujado a mano en un canvas)
     ====================================================================== */
  function dibujarGrafico() {
    const dpr = window.devicePixelRatio || 1;
    const w = grafico.clientWidth, h = grafico.clientHeight;
    if (!w) return;
    if (grafico.width !== Math.round(w * dpr) || grafico.height !== Math.round(h * dpr)) {
      grafico.width = Math.round(w * dpr); grafico.height = Math.round(h * dpr);
    }
    const g = grafico.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const m = { l: 44, r: 12, t: 14, b: 38 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const ms = mundo.muestras;
    const tMax = Math.max(120, mundo.t);
    let yMax = 10;
    for (const s of ms) yMax = Math.max(yMax, s.porMin);
    const paso = yMax > 200 ? 100 : yMax > 100 ? 50 : yMax > 40 ? 20 : 10;
    yMax = Math.ceil(yMax * 1.1 / paso) * paso;

    const X = t => m.l + (t / tMax) * pw;
    const Y = v => m.t + ph - (v / yMax) * ph;

    g.font = '11px system-ui, sans-serif';
    g.fillStyle = '#6b665c'; g.strokeStyle = '#e8e4da'; g.lineWidth = 1;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4, y = Y(v);
      g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke();
      g.fillText(Math.round(v), m.l - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const paso60 = tMax > 600 ? 120 : tMax > 300 ? 60 : 30;
    for (let t = 0; t <= tMax; t += paso60) g.fillText(formatoTiempo(t), X(t), h - m.b + 6);
    g.fillText('tiempo simulado (min:s)', m.l + pw / 2, h - 13);
    g.save(); g.translate(11, m.t + ph / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = 'middle'; g.fillText('comida / min', 0, 0); g.restore();

    // Línea vertical por cada cambio del entorno
    mundo.eventos.forEach((ev, i) => {
      const x = X(ev.t);
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = '#ea580c'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, m.t + ph); g.stroke(); g.restore();
      g.fillStyle = '#ea580c'; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText(String(i + 1), x, m.t + 11);
    });

    // Curva
    if (ms.length > 1) {
      g.beginPath();
      ms.forEach((s, i) => { const x = X(s.t), y = Y(s.porMin); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = '#3d6b57'; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke();
    }
    g.strokeStyle = '#cfc9ba'; g.lineWidth = 1;
    g.strokeRect(m.l, m.t, pw, ph);
  }

  function listarEventos() {
    const ul = $('listaEventos');
    ul.innerHTML = '';
    if (!mundo.eventos.length) {
      const li = document.createElement('li');
      li.textContent = 'Las líneas naranjas verticales marcarán cada cambio del entorno.';
      ul.appendChild(li);
      return;
    }
    mundo.eventos.forEach((ev, i) => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = (i + 1) + '. ';
      li.appendChild(b);
      li.appendChild(document.createTextNode(formatoTiempo(ev.t) + ' — ' + ev.etiqueta));
      ul.appendChild(li);
    });
  }

  // El texto de recuperación de cada evento cambia con el tiempo: se refresca con las muestras.
  window.addEventListener('resize', () => { muestrasDibujadas = -1; });

  /* ======================================================================
     DESCARGA DE RESULTADOS (CSV)
     ====================================================================== */
  function csvCampo(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function descargarCsv() {
    const cab = ['escenario', 'hormigas', 'evaporacion_pct_por_paso', 'exploracion_pct', 'velocidad_x',
      'tiempo_s', 'comida_total', 'comida_en_intervalo', 'comida_por_minuto', 'pct_ruta_corta',
      'hormigas_buscando', 'hormigas_cargando', 't_primera_comida_s', 'cambio_en_intervalo', 't_recuperacion_s'];
    const filas = [cab.join(',')];
    let previo = -1;
    for (const m of mundo.muestras) {
      const evs = mundo.eventos.filter(e => e.t > previo && e.t <= m.t);
      const pasados = mundo.eventos.filter(e => e.t <= m.t);
      const ult = pasados[pasados.length - 1];
      filas.push([
        S.ESCENARIOS[escenarioActual].nombre,
        m.hormigas, m.evaporacion, Math.round(m.exploracion * 100), velocidad(),
        m.t, m.total, m.intervalo, m.porMin.toFixed(1),
        m.pctCorta === null ? '' : m.pctCorta.toFixed(1),
        m.buscando, m.llevando,
        mundo.primeraComida !== null && mundo.primeraComida <= m.t ? mundo.primeraComida.toFixed(1) : '',
        evs.map(e => e.etiqueta).join(' | '),
        ult && ult.estado === 'ok' ? Math.round(ult.rec) : '',
      ].map(csvCampo).join(','));
      previo = m.t;
    }
    // BOM al inicio para que Excel respete las tildes
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'resultados_' + escenarioActual + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('btnCsv').addEventListener('click', descargarCsv);

  /* ---------------- Arranque ---------------- */
  cargarEscenario('basico');
  requestAnimationFrame(bucle);
})();
