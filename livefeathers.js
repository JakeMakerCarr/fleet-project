(function () {
  const STORAGE_KEY = 'yfned-feathers-enabled';
  const DISABLED_BODY_CLASS = 'feathers-disabled';

  function getFeathersEnabled() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch (error) {
      return true;
    }
  }

  function setFeathersEnabled(enabled) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch (error) {
      // Ignore storage failures; the current page still updates.
    }
  }

  function applyDisabledClass(enabled) {
    document.body.classList.toggle(DISABLED_BODY_CLASS, !enabled);
  }

  function syncToggleButton(button, enabled) {
    button.setAttribute('aria-pressed', String(enabled));
    button.classList.toggle('feathers-enabled', enabled);
  }

  function initLiveFeatherBackground(options) {
    const settings = {
      canvasId: 'feather-canvas',
      bodyClass: 'live-feather-background',
      desktopQuery: '(min-width: 900px)',
      reducedMotionQuery: '(prefers-reduced-motion: reduce)',
      featherSources: ['assets/blackfeather.png'],
      initialCount: 80,
      maxCount: 140,
      spawnIntervalMs: 850,
      backgroundColor: '#1f8fca',
      speedMultiplier: 0.35,
      ...options
    };

    let feathersEnabled = getFeathersEnabled();
    applyDisabledClass(feathersEnabled);

    const featherCanvas = document.getElementById(settings.canvasId);
    const ctx = featherCanvas && featherCanvas.getContext('2d');
    if (!ctx || !featherCanvas) {
      initFeatherToggleButton({
        isEnabled: () => feathersEnabled,
        setEnabled: enabled => {
          feathersEnabled = enabled;
          setFeathersEnabled(enabled);
          applyDisabledClass(enabled);
        }
      });
      return;
    }

    const desktopQuery = window.matchMedia(settings.desktopQuery);
    const reducedMotionQuery = window.matchMedia(settings.reducedMotionQuery);
    const featherImages = settings.featherSources.map(src => {
      const image = new Image();
      image.src = src;
      return image;
    });

    const feathers = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationFrameId = null;
    let spawnTimerId = null;

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function resizeCanvas() {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      featherCanvas.width = Math.round(width * dpr);
      featherCanvas.height = Math.round(height * dpr);
      featherCanvas.style.width = width + 'px';
      featherCanvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function createFeather(initial) {
      const image = featherImages[Math.floor(Math.random() * featherImages.length)];
      const speed = settings.speedMultiplier;
        return {
          image,
          x: randomBetween(-80, width + 80),
          y: initial ? randomBetween(-height, height) : randomBetween(-180, -30),
          scale: 1,
          speedY: randomBetween(0.36, 0.95) * speed,
          driftBase: randomBetween(-0.18, 0.18) * speed,
          driftAmplitude: randomBetween(0.3, 1.1) * speed,
        driftFrequency: randomBetween(0.008, 0.022) * speed,
        phase: randomBetween(0, Math.PI * 2),
        rotation: randomBetween(0, Math.PI * 2),
        rotationSpeed: randomBetween(-0.007, 0.007) * speed,
        opacity: randomBetween(0.68, 0.95)
      };
    }

    function drawFeather(feather) {
      const image = feather.image;
      if (!image.complete || !image.naturalWidth) return;

      const drawWidth = image.naturalWidth * feather.scale;
      const drawHeight = image.naturalHeight * feather.scale;

      ctx.save();
      ctx.globalAlpha = feather.opacity;
      ctx.translate(feather.x, feather.y);
      ctx.rotate(feather.rotation);
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    }

    function tick() {
      ctx.clearRect(0, 0, width, height);

      for (let i = feathers.length - 1; i >= 0; i -= 1) {
        const feather = feathers[i];
        feather.phase += feather.driftFrequency;
        feather.y += feather.speedY;
        feather.x += feather.driftBase + Math.sin(feather.phase) * feather.driftAmplitude;
        feather.rotation += feather.rotationSpeed + Math.sin(feather.phase * 0.8) * 0.002 * settings.speedMultiplier;

        const maxDimension = Math.max(
          (feather.image && feather.image.naturalWidth ? feather.image.naturalWidth : 44) * feather.scale,
          (feather.image && feather.image.naturalHeight ? feather.image.naturalHeight : 44) * feather.scale
        );

        if (feather.y - maxDimension > height + 48 || feather.x < -140 || feather.x > width + 140) {
          feathers.splice(i, 1);
          continue;
        }

        drawFeather(feather);
      }

      animationFrameId = window.requestAnimationFrame(tick);
    }

    function startAnimation() {
      if (!feathersEnabled || animationFrameId || spawnTimerId || !desktopQuery.matches || reducedMotionQuery.matches) return;

      document.body.classList.add(settings.bodyClass);
      document.body.classList.remove(DISABLED_BODY_CLASS);
      document.body.style.backgroundColor = settings.backgroundColor;
      resizeCanvas();
      feathers.length = 0;

      for (let i = 0; i < settings.initialCount; i += 1) {
        feathers.push(createFeather(true));
      }

      spawnTimerId = window.setInterval(function () {
        if (feathers.length < settings.maxCount) {
          feathers.push(createFeather(false));
        }
      }, settings.spawnIntervalMs);

      tick();
    }

    function stopAnimation() {
      document.body.classList.remove(settings.bodyClass);
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (spawnTimerId) {
        window.clearInterval(spawnTimerId);
        spawnTimerId = null;
      }
      feathers.length = 0;
      ctx.clearRect(0, 0, width, height);
    }

    function syncAnimationMode() {
      applyDisabledClass(feathersEnabled);
      if (feathersEnabled && desktopQuery.matches && !reducedMotionQuery.matches) {
        startAnimation();
      } else {
        stopAnimation();
      }
    }

    window.addEventListener('resize', function () {
      if (desktopQuery.matches && !reducedMotionQuery.matches) {
        resizeCanvas();
      }
    });
    desktopQuery.addEventListener('change', syncAnimationMode);
    reducedMotionQuery.addEventListener('change', syncAnimationMode);
    initFeatherToggleButton({
      isEnabled: () => feathersEnabled,
      setEnabled: enabled => {
        feathersEnabled = enabled;
        setFeathersEnabled(enabled);
        syncAnimationMode();
      }
    });
    syncAnimationMode();
  }

  function initFeatherToggleButton(controller) {
    const logoutButton = document.getElementById('logout-btn');
    if (!logoutButton || document.getElementById('feathers-toggle-btn')) return;

    const button = document.createElement('button');
    button.id = 'feathers-toggle-btn';
    button.type = 'button';
    button.className = 'header-btn feathers-toggle-btn';
    button.textContent = 'Feathers';
    button.title = 'Toggle falling feathers';
    syncToggleButton(button, controller.isEnabled());

    button.addEventListener('click', () => {
      const enabled = !controller.isEnabled();
      controller.setEnabled(enabled);
      syncToggleButton(button, enabled);
    });

    logoutButton.parentNode.insertBefore(button, logoutButton);
  }

  window.initLiveFeatherBackground = initLiveFeatherBackground;
})();
