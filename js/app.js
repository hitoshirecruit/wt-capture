/**
 * app.js
 * アプリ全体の制御・カメラ初期化・アニメーションループ
 */
(async () => {

  // ---- DOM参照 ----
  const video         = document.getElementById('video');
  const canvas        = document.getElementById('canvas');
  const ctx           = canvas.getContext('2d', { alpha: false });
  const screenSelect  = document.getElementById('screen-select');
  const screenCamera  = document.getElementById('screen-camera');
  const exerciseLabel = document.getElementById('exercise-label');
  const modelStatus   = document.getElementById('model-status');
  const recordTimer   = document.getElementById('record-timer');
  const btnRecord     = document.getElementById('btn-record');
  const btnBack       = document.getElementById('btn-back');

  // ---- 状態 ----
  let currentExercise = null;
  let animationId     = null;
  let isModelReady    = false;
  let frameCount      = 0;
  let lastKeypoints   = null;

  // ---- Canvasをスクリーンにフィット（縦横比を保持・黒帯あり）----
  function fitCanvas() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!canvas.width || !canvas.height) return;

    const videoAspect  = canvas.width / canvas.height;
    const screenAspect = vw / vh;

    let w, h;
    if (screenAspect > videoAspect) {
      // 画面の方が横長 → 高さに合わせる
      h = vh;
      w = vh * videoAspect;
    } else {
      // 画面の方が縦長 → 幅に合わせる
      w = vw;
      h = vw / videoAspect;
    }

    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.left   = ((vw - w) / 2) + 'px';
    canvas.style.top    = ((vh - h) / 2) + 'px';
  }

  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 300));

  // ---- カメラ初期化 ----
  async function startCamera() {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280, max: 1280 },
        height: { ideal: 720,  max: 720  },
        frameRate: { ideal: 30 },
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
      await video.play();

      // Canvas内部解像度をビデオに合わせる
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      fitCanvas();

      return true;
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'カメラを許可してください\nSafari設定 > カメラ'
        : `カメラエラー: ${err.message}`;
      modelStatus.textContent = msg;
      return false;
    }
  }

  // ---- カメラ停止 ----
  function stopCamera() {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
  }

  // ---- アニメーションループ ----
  // カメラ映像はモデル不要で即表示。モデルが準備できたら骨格を重ねる。
  function animationLoop() {
    animationId = requestAnimationFrame(animationLoop);

    // モデル準備済みのときだけ推論（3フレームに1回）
    if (isModelReady && frameCount % 3 === 0) {
      PoseDetector.detect(video).then(kps => {
        lastKeypoints = kps;
      });
    }
    frameCount++;

    const angles = (isModelReady && lastKeypoints)
      ? AngleCalculator.getAngles(lastKeypoints, currentExercise)
      : null;

    Renderer.drawFrame(
      ctx, video,
      isModelReady ? lastKeypoints : null,
      angles, currentExercise,
      canvas.width, canvas.height
    );
  }

  // ---- 画面切り替え ----
  function showScreen(name) {
    screenSelect.classList.remove('active');
    screenCamera.classList.remove('active');
    if (name === 'select') screenSelect.classList.add('active');
    if (name === 'camera') screenCamera.classList.add('active');
  }

  // ---- エクササイズボタン ----
  const EXERCISE_NAMES = {
    squat:     'スクワット',
    deadlift:  'デッドリフト',
    bulgarian: 'ブルガリアンスクワット',
  };

  document.querySelectorAll('.btn-exercise').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentExercise = btn.dataset.exercise;
      exerciseLabel.textContent = EXERCISE_NAMES[currentExercise];
      frameCount    = 0;
      lastKeypoints = null;
      showScreen('camera');

      // ── Step1: カメラを先に起動 ──
      modelStatus.textContent = 'カメラ起動中...';
      const cameraOk = await startCamera();

      if (!cameraOk) return; // カメラ失敗 → ここで止まる

      // カメラOK → すぐにループ開始・RECボタン有効化
      animationLoop();
      btnRecord.disabled = false;

      // ── Step2: モデルをバックグラウンドで読み込む ──
      if (!isModelReady) {
        modelStatus.textContent = 'AI読み込み中...';
        const ok = await PoseDetector.init(msg => {
          modelStatus.textContent = msg;
        });
        isModelReady = ok;
        modelStatus.textContent = ok ? '準備完了' : 'AI読み込み失敗（録画のみ可）';
      } else {
        modelStatus.textContent = '準備完了';
      }
    });
  });

  // ---- RECボタン ----
  btnRecord.addEventListener('click', async () => {
    if (!Recorder.isRecording()) {
      Recorder.startRecording(canvas, (time) => {
        recordTimer.textContent = time;
      });
      btnRecord.textContent = 'STOP';
      btnRecord.classList.add('recording');
      recordTimer.classList.remove('hidden');
    } else {
      btnRecord.disabled = true;
      await Recorder.stopRecording(currentExercise);
      btnRecord.textContent = 'REC';
      btnRecord.classList.remove('recording');
      btnRecord.disabled = false;
      recordTimer.classList.add('hidden');
      recordTimer.textContent = '00:00';
    }
  });

  // ---- 戻るボタン ----
  btnBack.addEventListener('click', async () => {
    if (Recorder.isRecording()) {
      if (!confirm('録画中です。停止して戻りますか？')) return;
      await Recorder.stopRecording(currentExercise);
    }

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    stopCamera();
    lastKeypoints = null;

    btnRecord.textContent = 'REC';
    btnRecord.classList.remove('recording');
    btnRecord.disabled = true;
    recordTimer.classList.add('hidden');
    recordTimer.textContent = '00:00';

    showScreen('select');
  });

})();
