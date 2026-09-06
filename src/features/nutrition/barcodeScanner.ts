import type { BrowserMultiFormatReader } from '@zxing/browser';

export type ScannerReadyState = {
  width: number;
  height: number;
  supportsTorch: boolean;
  continuousFocusRequested: boolean;
};

export type BarcodeScannerSession = {
  stop: () => void;
  setTorch: (enabled: boolean) => Promise<void>;
  supportsTorch: boolean;
};

type NativeBarcode = { rawValue: string };
type NativeBarcodeDetector = { detect: (source: ImageBitmapSource) => Promise<NativeBarcode[]> };
type NativeBarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

const SCANNER_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
const SCAN_DELAY_MS = 240;
const MAX_FRAME_WIDTH = 1440;

function normalizeBarcode(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(digits)) return null;

  // EAN/UPC are GTIN values. Rejecting a failed checksum prevents a noisy frame
  // from becoming a false product search, while still accepting all usual retail lengths.
  let sum = 0;
  for (let index = digits.length - 2, distance = 0; index >= 0; index -= 1, distance += 1) {
    sum += Number(digits[index]) * (distance % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

function nativeDetector(): NativeBarcodeDetector | null {
  const Detector = (window as Window & { BarcodeDetector?: NativeBarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    return new Detector({ formats: [...SCANNER_FORMATS] });
  } catch {
    return null;
  }
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawScanVariant(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  variant: number,
) {
  const crop = variant === 0
    ? { x: 0, y: 0, width: 1, height: 1, contrast: false }
    : variant === 1
      ? { x: 0.05, y: 0.28, width: 0.9, height: 0.5, contrast: false }
      : { x: 0.06, y: 0.35, width: 0.88, height: 0.34, contrast: true };
  const sourceX = Math.round(sourceWidth * crop.x);
  const sourceY = Math.round(sourceHeight * crop.y);
  const sourceCropWidth = Math.round(sourceWidth * crop.width);
  const sourceCropHeight = Math.round(sourceHeight * crop.height);
  const scale = Math.min(2, MAX_FRAME_WIDTH / sourceCropWidth);
  const outputWidth = Math.max(1, Math.round(sourceCropWidth * scale));
  const outputHeight = Math.max(1, Math.round(sourceCropHeight * scale));

  if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
    canvas.width = outputWidth;
    canvas.height = outputHeight;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Не удалось подготовить кадр камеры');

  context.save();
  context.imageSmoothingEnabled = !crop.contrast;
  context.filter = crop.contrast ? 'grayscale(1) contrast(220%)' : 'none';
  context.drawImage(source, sourceX, sourceY, sourceCropWidth, sourceCropHeight, 0, 0, outputWidth, outputHeight);
  context.restore();
}

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  reader: BrowserMultiFormatReader,
  detector: NativeBarcodeDetector | null,
): Promise<string | null> {
  if (detector) {
    try {
      const nativeMatches = await detector.detect(canvas);
      for (const match of nativeMatches) {
        const barcode = normalizeBarcode(match.rawValue);
        if (barcode) return barcode;
      }
    } catch {
      // Browser support for BarcodeDetector varies. ZXing remains the reliable fallback.
    }
  }

  try {
    return normalizeBarcode(reader.decodeFromCanvas(canvas).getText());
  } catch {
    return null;
  }
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
}

async function createReader(): Promise<BrowserMultiFormatReader> {
  const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: SCAN_DELAY_MS,
    delayBetweenScanSuccess: 500,
  });
  reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];
  return reader;
}

export async function decodeBarcodeImage(file: File): Promise<string | null> {
  const [reader, image] = await Promise.all([createReader(), loadImage(file)]);
  const detector = nativeDetector();
  const canvas = createCanvas(1, 1);

  try {
    for (const variant of [0, 1, 2]) {
      drawScanVariant(canvas, image.source, image.width, image.height, variant);
      const barcode = await decodeCanvas(canvas, reader, detector);
      if (barcode) return barcode;
    }
    return null;
  } finally {
    image.dispose();
  }
}

export async function startBarcodeScanner({
  video,
  onBarcode,
  onReady,
}: {
  video: HTMLVideoElement;
  onBarcode: (barcode: string) => void;
  onReady: (state: ScannerReadyState) => void;
}): Promise<BarcodeScannerSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 },
    },
  });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new DOMException('Не найдена камера', 'NotFoundError');
  }

  let continuousFocusRequested = false;
  const capabilities = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
  if (capabilities.focusMode?.includes('continuous')) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
      continuousFocusRequested = true;
    } catch {
      // The browser may advertise a focus mode yet reject it at runtime.
    }
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Камера не передала изображение')), 5000);
      video.addEventListener('loadedmetadata', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  const [reader, detector] = await Promise.all([createReader(), Promise.resolve(nativeDetector())]);
  const canvas = createCanvas(1, 1);
  const supportsTorch = capabilities.torch === true;
  let stopped = false;
  let scanning = false;
  let variant = 0;
  let timer: number | null = null;

  const stop = () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    stream.getTracks().forEach((item) => item.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };

  const scanNextFrame = async () => {
    if (stopped || scanning) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      timer = window.setTimeout(() => void scanNextFrame(), SCAN_DELAY_MS);
      return;
    }

    scanning = true;
    try {
      drawScanVariant(canvas, video, video.videoWidth, video.videoHeight, variant);
      variant = (variant + 1) % 3;
      const barcode = await decodeCanvas(canvas, reader, detector);
      if (barcode && !stopped) {
        stop();
        onBarcode(barcode);
        return;
      }
    } finally {
      scanning = false;
    }
    if (!stopped) timer = window.setTimeout(() => void scanNextFrame(), SCAN_DELAY_MS);
  };

  onReady({
    width: video.videoWidth,
    height: video.videoHeight,
    supportsTorch,
    continuousFocusRequested,
  });
  void scanNextFrame();

  return {
    stop,
    supportsTorch,
    setTorch: async (enabled) => {
      if (!supportsTorch) return;
      await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
    },
  };
}
