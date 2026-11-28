(() => {
  'use strict';

  const api = window.bardo;
  const NICK_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
  const CATALOGO_SERVIDORES_RESPALDO = Object.freeze([
    Object.freeze({ id: 'srv_01', nombre: 'Hispanicraft', activo: true, versionMinecraft: '1.20.1', requiereMods: true, cargadorMods: 'fabric' })
  ]);
  const pagina = window.location.pathname.split('/').pop().toLowerCase() || 'index.html';
  const porId = id => document.getElementById(id);
  const navegar = archivo => { window.location.href = archivo; };
  let servidorSeleccionado = null;
  let alCambiarServidorSeleccionado = () => {};

  function iniciarLogin() {
    const btnPremium = porId('btn-premium');
    const btnGuest = porId('btn-guest-mode');
    const btnIngresar = porId('btn-login');
    const btnVolver = porId('back-to-methods');
    const metodos = porId('auth-methods');
    const formulario = porId('nick-form');
    const nick = porId('input-nick');
    if (!btnPremium || !btnGuest || !btnIngresar || !btnVolver || !metodos || !formulario || !nick) return;

    const controlesLogin = [btnPremium, btnGuest, btnIngresar, btnVolver, nick];
    const establecerAutenticacionEnCurso = activa => {
      controlesLogin.forEach(control => {
        if ('disabled' in control) control.disabled = activa;
        control.style.pointerEvents = activa ? 'none' : '';
        control.style.filter = activa ? 'brightness(0.7)' : '';
        control.style.cursor = activa ? 'wait' : '';
      });
    };

    btnGuest.addEventListener('click', () => {
      metodos.classList.add('hidden'); formulario.classList.remove('hidden'); btnVolver.classList.remove('hidden'); nick.focus();
    });
    btnVolver.addEventListener('click', () => {
      formulario.classList.add('hidden'); btnVolver.classList.add('hidden'); metodos.classList.remove('hidden');
    });
    nick.addEventListener('input', () => { nick.value = nick.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); });
    btnIngresar.addEventListener('click', async () => {
      const valor = nick.value.trim();
      if (!NICK_VALIDO.test(valor)) return nick.focus();
      btnIngresar.disabled = true;
      try {
        const resultado = await api.guardarNick(valor);
        if (resultado.ok) navegar('inicio.html');
      } catch (error) {
        console.error('[Bardo] No se pudo guardar el Nick:', error);
        btnIngresar.disabled = false;
      }
    });
    btnPremium.addEventListener('click', async () => {
      establecerAutenticacionEnCurso(true);
      try {
        const resultado = await api.iniciarLoginMicrosoft();
        if (resultado.ok) navegar('inicio.html');
      } catch (error) {
        console.error('[Bardo] Inicio de sesión Microsoft cancelado o fallido:', error);
        establecerAutenticacionEnCurso(false);
      }
    });
  }

  async function restaurarSesion() {
    try {
      const perfil = await api.obtenerPerfil();
      if (perfil.nick) navegar('inicio.html');
    } catch (error) {
      console.error('[Bardo] No se pudo restaurar la sesión:', error);
    }
  }

  function cargarAvatarDeSkin(uuid) {
    const contenedor = document.querySelector('.account-avatar-wrapper');
    if (!contenedor || !uuid) return;

    const avatar = new Image(50, 50);
    avatar.alt = 'Cara de la skin';
    avatar.decoding = 'async';
    avatar.style.cssText = 'width:50px;height:50px;display:block;border-radius:12px;';
    avatar.addEventListener('load', () => contenedor.replaceChildren(avatar), { once: true });
    // MCHeads acepta UUIDs oficiales y entrega sólo la cara de la skin.
    avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/50`;
  }

  function crearIconoServidor() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'icon icon-tabler icons-tabler-outline icon-tabler-server');
    svg.innerHTML = '<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2" /><path d="M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2" /><path d="M7 8l0 .01" /><path d="M7 16l0 .01" />';
    return svg;
  }

  function etiquetaVersion(servidor) {
    const cargador = servidor.requiereMods && servidor.cargadorMods
      ? ` · ${servidor.cargadorMods}`
      : '';
    return `Minecraft ${servidor.versionMinecraft}${cargador}`;
  }

  function actualizarServidorSeleccionado(servidor) {
    servidorSeleccionado = servidor;
    const nombre = porId('txt-server-name');
    const version = porId('txt-server-version');
    if (nombre) nombre.textContent = servidor.nombre;
    if (version) version.textContent = etiquetaVersion(servidor);
    void alCambiarServidorSeleccionado(servidor);
  }

  function renderizarServidores(servidores) {
    const contenedor = porId('contenedor-servidores');
    if (!contenedor) return;

    const servidoresActivos = servidores.filter(servidor => servidor.activo);
    const fragmento = document.createDocumentFragment();
    servidoresActivos.forEach(servidor => {
      const fila = document.createElement('div');
      fila.className = 'sidebar-menu-row';
      fila.dataset.serverId = servidor.id;

      const icono = document.createElement('div');
      icono.className = 'server-icon';
      icono.append(crearIconoServidor());

      const nombre = document.createElement('span');
      nombre.className = 'sidebar-text-fade item-label-text';
      nombre.textContent = servidor.nombre;

      fila.append(icono, nombre);
      fila.addEventListener('click', () => actualizarServidorSeleccionado(servidor));
      fragmento.append(fila);
    });
    contenedor.replaceChildren(fragmento);
    if (servidoresActivos[0]) actualizarServidorSeleccionado(servidoresActivos[0]);
  }

  async function cargarCatalogoServidores() {
    try {
      const resultado = await api.leerPizarraRemota();
      const servidores = Array.isArray(resultado?.servidores) && resultado.servidores.length
        ? resultado.servidores
        : CATALOGO_SERVIDORES_RESPALDO;
      renderizarServidores(servidores);
    } catch (error) {
      console.error('[Bardo] No se pudo cargar el catálogo remoto:', error);
      renderizarServidores(CATALOGO_SERVIDORES_RESPALDO);
    }
  }

  async function iniciarInicio() {
    const nombreCuenta = document.querySelector('.account-player-name');
    const cerrarSesion = document.querySelector('.account-logout-btn');
    const contenidoPrincipal = porId('main-action-content');
    const botonJugar = porId('btn-play');
    const barraProgreso = porId('play-progress');
    const rellenoProgreso = porId('play-progress-fill');
    const contenidoOriginalBotonJugar = botonJugar?.innerHTML || 'JUGAR';
    let operacionEnCurso = false;
    let instalandoInstancia = false;
    let iniciandoJuego = false;
    let estadoInstancia = 'no-instalado';
    let porcentajeVisual = 0;
    let temporizadorProgreso = null;
    let temporizadorOcultarProgreso = null;
    const ICONO_INSTALAR = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-download"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" /></svg>';
    const ICONO_ACTUALIZAR = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-refresh"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>';

    const fijarAnchoDinamicoDelBoton = async () => {
      if (!botonJugar) return;
      if (document.fonts?.ready) await document.fonts.ready;

      const variantes = [
        contenidoOriginalBotonJugar,
        `${ICONO_INSTALAR} INSTALAR`,
        `${ICONO_ACTUALIZAR} ACTUALIZAR`,
        'INSTALANDO',
        'ACTUALIZANDO',
        'INICIANDO',
        'EN EJECUCIÓN'
      ];
      const medidor = botonJugar.cloneNode(false);
      medidor.removeAttribute('id');
      medidor.disabled = false;
      medidor.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;width:auto;min-width:0;margin:0;white-space:nowrap;pointer-events:none;';
      document.body.append(medidor);

      const anchoMaximo = Math.max(...variantes.map(variante => {
        medidor.innerHTML = variante;
        return medidor.getBoundingClientRect().width;
      }));
      medidor.remove();
      botonJugar.style.width = `${Math.ceil(anchoMaximo)}px`;
    };
    void fijarAnchoDinamicoDelBoton();

    const detenerAnimacionDeProgreso = () => {
      if (temporizadorProgreso) clearInterval(temporizadorProgreso);
      temporizadorProgreso = null;
    };

    const actualizarBarraDeProgreso = porcentaje => {
      if (!barraProgreso || !rellenoProgreso) return;
      porcentajeVisual = Math.max(0, Math.min(100, Math.round(Number(porcentaje) || 0)));
      rellenoProgreso.style.width = `${porcentajeVisual}%`;
      barraProgreso.setAttribute('aria-valuenow', String(porcentajeVisual));
    };

    const mostrarBarraDeProgreso = () => {
      if (!barraProgreso || !botonJugar) return;
      if (temporizadorOcultarProgreso) clearTimeout(temporizadorOcultarProgreso);
      temporizadorOcultarProgreso = null;
      barraProgreso.style.display = 'block';
    };

    const iniciarBarraDeProgreso = () => {
      detenerAnimacionDeProgreso();
      mostrarBarraDeProgreso();
      actualizarBarraDeProgreso(0);
      temporizadorProgreso = setInterval(() => {
        if (porcentajeVisual < 90) actualizarBarraDeProgreso(porcentajeVisual + 4);
      }, 260);
    };

    const ocultarBarraDeProgreso = () => {
      detenerAnimacionDeProgreso();
      if (temporizadorOcultarProgreso) clearTimeout(temporizadorOcultarProgreso);
      temporizadorOcultarProgreso = null;
      if (!barraProgreso) return;
      barraProgreso.style.display = 'none';
      actualizarBarraDeProgreso(0);
    };

    const completarYocultarBarraDeProgreso = () => {
      detenerAnimacionDeProgreso();
      actualizarBarraDeProgreso(100);
      if (temporizadorOcultarProgreso) clearTimeout(temporizadorOcultarProgreso);
      temporizadorOcultarProgreso = setTimeout(ocultarBarraDeProgreso, 200);
    };

    const aplicarEstadoBoton = estado => {
      estadoInstancia = estado;
      if (!botonJugar) return;
      botonJugar.classList.remove('estado-instalar', 'estado-actualizar', 'estado-cargando');
      botonJugar.disabled = false;
      if (estado === 'no-instalado') {
        botonJugar.classList.add('estado-instalar');
        botonJugar.innerHTML = `${ICONO_INSTALAR} INSTALAR`;
      } else if (estado === 'desactualizado') {
        botonJugar.classList.add('estado-actualizar');
        botonJugar.innerHTML = `${ICONO_ACTUALIZAR} ACTUALIZAR`;
      } else {
        botonJugar.innerHTML = contenidoOriginalBotonJugar;
      }
    };

    const consultarEstadoInstancia = async () => {
      if (!servidorSeleccionado || operacionEnCurso) return;
      try {
        const resultado = await api.verificarEstadoInstancia(servidorSeleccionado);
        aplicarEstadoBoton(resultado?.estado || 'no-instalado');
      } catch (error) {
        console.error('[Bardo] No se pudo verificar la instancia:', error);
        aplicarEstadoBoton('no-instalado');
      }
    };

    const restaurarBotonJugar = () => {
      operacionEnCurso = false;
      instalandoInstancia = false;
      iniciandoJuego = false;
      ocultarBarraDeProgreso();
      aplicarEstadoBoton(estadoInstancia);
    };

    const mostrarProgresoDeJuego = progreso => {
      if (!botonJugar || !operacionEnCurso || !progreso) return;

      if (progreso.estado === 'descargando' && Number.isFinite(progreso.porcentaje)) {
        actualizarBarraDeProgreso(progreso.porcentaje);
      }

      // Instalación y lanzamiento conservan un único mensaje sin progreso técnico.
      if ((instalandoInstancia && !['instalado', 'error'].includes(progreso.estado)) ||
          (iniciandoJuego && !['iniciado', 'cerrado', 'error'].includes(progreso.estado))) return;

      if (progreso.estado === 'iniciado') {
        botonJugar.textContent = 'EN EJECUCIÓN';
        completarYocultarBarraDeProgreso();
        return;
      }
      if (progreso.estado === 'instalado') {
        operacionEnCurso = false;
        instalandoInstancia = false;
        completarYocultarBarraDeProgreso();
        void consultarEstadoInstancia();
        return;
      }
      if (progreso.estado === 'cerrado' || progreso.estado === 'error') restaurarBotonJugar();
    };

    const dejarDeEscucharProgreso = api.onProgresoJuego(mostrarProgresoDeJuego);
    window.addEventListener('beforeunload', () => {
      dejarDeEscucharProgreso();
      ocultarBarraDeProgreso();
    }, { once: true });

    alCambiarServidorSeleccionado = consultarEstadoInstancia;
    await cargarCatalogoServidores();
    await consultarEstadoInstancia();
    contenidoPrincipal?.classList.add('is-ready');
    porId('btn-settings')?.addEventListener('click', () => navegar('ajustes.html'));
    cerrarSesion?.addEventListener('click', async () => {
      try {
        await api.cerrarSesion();
        navegar('index.html');
      } catch (error) {
        console.error('[Bardo] No se pudo cerrar sesión:', error);
      }
    });
    botonJugar?.addEventListener('click', async () => {
      if (operacionEnCurso || !servidorSeleccionado) return;

      operacionEnCurso = true;
      botonJugar.disabled = true;
      const instanciaObjetivo = servidorSeleccionado;
      const instalando = estadoInstancia !== 'listo';
      instalandoInstancia = instalando;
      iniciandoJuego = !instalando;
      if (instalando) {
        botonJugar.classList.add('estado-cargando');
        botonJugar.textContent = estadoInstancia === 'desactualizado' ? 'ACTUALIZANDO' : 'INSTALANDO';
      } else {
        botonJugar.classList.add('estado-cargando');
        botonJugar.textContent = 'INICIANDO';
      }
      iniciarBarraDeProgreso();

      try {
        const perfil = await api.obtenerPerfil();
        const resultado = instalando
          ? await api.instalarInstancia({ instancia: instanciaObjetivo })
          : await api.lanzarJuego({
          instancia: instanciaObjetivo,
          ram: perfil.ram
        });

        if (!resultado?.ok) {
          console.error(`[Bardo] No se pudo ${instalando ? 'instalar' : 'iniciar'} la instancia:`, resultado?.error);
          restaurarBotonJugar();
        } else if (instalando) {
          operacionEnCurso = false;
          instalandoInstancia = false;
          await consultarEstadoInstancia();
        }
      } catch (error) {
        console.error('[Bardo] Error al solicitar el lanzamiento:', error);
        restaurarBotonJugar();
      }
    });

    if (!nombreCuenta) return;

    try {
      const perfil = await api.obtenerPerfil();
      nombreCuenta.textContent = perfil.nick || 'Invitado';
      cargarAvatarDeSkin(perfil.uuid);
    } catch (error) {
      console.error('[Bardo] No se pudo cargar el perfil:', error);
      nombreCuenta.textContent = 'Invitado';
    }
  }

  async function iniciarAjustes() {
    const sliderRam = document.querySelector('.ram-slider');
    const campoRam = document.querySelector('.ram-number-field');
    const unidadRam = porId('ram-unit');
    const textoMaximoRam = porId('ram-max-info');
    const pantallaCompleta = document.querySelector('.fullscreen-checkbox');
    const botonReparar = porId('btn-repair-client');
    porId('back-from-settings')?.addEventListener('click', () => navegar('inicio.html'));
    if (!sliderRam || !campoRam) return;

    let minimo = Number(sliderRam.min);
    let maximo = Number(sliderRam.max);
    let ultimoValorGuardado = null;
    const formatearRam = valor => Number(valor).toFixed(1);
    const limitarRam = valor => Math.round(Math.max(minimo, Math.min(maximo, Number(valor))) * 10) / 10;
    const actualizarAnchoCampoRam = () => {
      campoRam.style.width = `${Math.max(2, campoRam.value.length)}ch`;
    };
    const actualizarEtiquetaRam = valor => {
      const ram = Number(valor);
      if (ram < 1) {
        campoRam.value = String(Math.round(ram * 1000));
        if (unidadRam) unidadRam.textContent = 'MB';
      } else {
        campoRam.value = formatearRam(ram);
        if (unidadRam) unidadRam.textContent = 'GB';
      }
      actualizarAnchoCampoRam();
    };
    const guardarRam = async valor => {
      const normalizado = limitarRam(valor);
      sliderRam.value = String(normalizado);
      actualizarEtiquetaRam(normalizado);
      if (ultimoValorGuardado === normalizado) return;
      await api.guardarRam(normalizado);
      ultimoValorGuardado = normalizado;
    };

    try {
      const ajustes = await api.obtenerAjustes();
      minimo = Number(ajustes.ramMinima);
      maximo = Number(ajustes.ramMaxima);
      sliderRam.min = String(minimo);
      sliderRam.max = String(maximo);
      sliderRam.step = '0.1';
      const limites = document.querySelectorAll('.slider-limit-text');
      if (limites[0]) limites[0].textContent = minimo === 0.5 ? '500 MB' : `${formatearRam(minimo)}GB`;
      if (limites[1]) limites[1].textContent = `${formatearRam(maximo)}GB`;
      if (textoMaximoRam) textoMaximoRam.textContent = `máx. ${formatearRam(maximo)} GB`;
      const ram = Number(ajustes.ram);
      if (Number.isFinite(ram)) {
        sliderRam.value = String(limitarRam(ram));
        actualizarEtiquetaRam(sliderRam.value);
        ultimoValorGuardado = Number(sliderRam.value);
      }
      if (pantallaCompleta) pantallaCompleta.checked = Boolean(ajustes.fullscreen);
    } catch (error) {
      console.error('[Bardo] No se pudieron cargar los ajustes:', error);
    }

    actualizarEtiquetaRam(sliderRam.value);
    sliderRam.addEventListener('input', () => actualizarEtiquetaRam(sliderRam.value));
    sliderRam.addEventListener('change', async () => {
      try {
        await guardarRam(Number(sliderRam.value));
      } catch (error) {
        console.error('[Bardo] No se pudo guardar la RAM:', error);
      }
    });
    campoRam.addEventListener('input', () => {
      const sinCaracteresInvalidos = campoRam.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
      const [entero = '', ...decimales] = sinCaracteresInvalidos.split('.');
      campoRam.value = decimales.length ? `${entero}.${decimales.join('')}` : entero;
      actualizarAnchoCampoRam();
    });
    const confirmarCampoRam = async () => {
      try {
        const valorEscrito = Number(campoRam.value);
        const valorEnGb = unidadRam?.textContent === 'MB' ? valorEscrito / 1000 : valorEscrito;
        await guardarRam(Number.isFinite(valorEnGb) ? valorEnGb : minimo);
      } catch (error) {
        console.error('[Bardo] No se pudo guardar la RAM escrita:', error);
      }
    };
    campoRam.addEventListener('change', confirmarCampoRam);
    campoRam.addEventListener('blur', confirmarCampoRam);
    pantallaCompleta?.addEventListener('change', async () => {
      try {
        await api.guardarFullscreen(pantallaCompleta.checked);
      } catch (error) {
        console.error('[Bardo] No se pudo guardar pantalla completa:', error);
      }
    });
    botonReparar?.addEventListener('click', async () => {
      if (!window.confirm('Se verificará de nuevo Minecraft y Fabric. Tus mundos y configuraciones se conservarán. ¿Continuar?')) return;

      const textoOriginal = botonReparar.textContent;
      botonReparar.disabled = true;
      botonReparar.textContent = 'REPARANDO...';
      try {
        const resultado = await api.repararArchivosCliente();
        if (!resultado?.ok) throw new Error(resultado?.error || 'No se pudieron reparar los archivos.');
        botonReparar.textContent = 'ARCHIVOS REPARADOS';
        setTimeout(() => {
          botonReparar.textContent = textoOriginal;
          botonReparar.disabled = false;
        }, 1600);
      } catch (error) {
        console.error('[Bardo] No se pudo reparar el cliente:', error);
        botonReparar.textContent = textoOriginal;
        botonReparar.disabled = false;
      }
    });
  }

  if (!api) return console.error('[Bardo] El puente seguro no está disponible.');
  if (pagina === 'index.html') {
    iniciarLogin();
    restaurarSesion();
  }
  else if (pagina === 'inicio.html') iniciarInicio();
  else if (pagina === 'ajustes.html') iniciarAjustes();
})();
