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
    const nombre = porId('txt-server-name');
    const version = porId('txt-server-version');
    if (nombre) nombre.textContent = servidor.nombre;
    if (version) version.textContent = etiquetaVersion(servidor);
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
    await cargarCatalogoServidores();
    porId('btn-settings')?.addEventListener('click', () => navegar('ajustes.html'));
    cerrarSesion?.addEventListener('click', async () => {
      try {
        await api.cerrarSesion();
        navegar('index.html');
      } catch (error) {
        console.error('[Bardo] No se pudo cerrar sesión:', error);
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

  function iniciarAjustes() {
    const sliderRam = document.querySelector('.ram-slider');
    const campoRam = document.querySelector('.ram-number-field');
    porId('back-from-settings')?.addEventListener('click', () => navegar('inicio.html'));
    if (sliderRam && campoRam) sliderRam.addEventListener('input', () => { campoRam.value = `${sliderRam.value}.0GB`; });
  }

  if (!api) return console.error('[Bardo] El puente seguro no está disponible.');
  if (pagina === 'index.html') {
    iniciarLogin();
    restaurarSesion();
  }
  else if (pagina === 'inicio.html') iniciarInicio();
  else if (pagina === 'ajustes.html') iniciarAjustes();
})();
