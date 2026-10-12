(() => {
  'use strict';

  const api = window.bardo;
  const NICK_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
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
      btnPremium.disabled = true;
      try {
        const resultado = await api.iniciarLoginMicrosoft();
        if (resultado.ok) navegar('inicio.html');
      } catch (error) {
        console.error('[Bardo] Inicio de sesión Microsoft cancelado o fallido:', error);
        btnPremium.disabled = false;
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

  async function iniciarInicio() {
    const nombreCuenta = document.querySelector('.account-player-name');
    const cerrarSesion = document.querySelector('.account-logout-btn');
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
