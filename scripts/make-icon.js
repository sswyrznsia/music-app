const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.join(__dirname, "..");
const ICON_DIR = path.join(ROOT_DIR, "assets", "icons");
const SOURCE_PNG = path.join(ICON_DIR, "pulse-shelf-source.png");
const FALLBACK_SOURCE_PNG = path.join(ICON_DIR, "pulse-shelf.png");
const TARGET_ICO = path.join(ICON_DIR, "pulse-shelf.ico");
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PADDING_RATIO = 0.06;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function main() {
  ensureSourcePng();

  const source = fs.readFileSync(SOURCE_PNG);
  assertPng(source, SOURCE_PNG);
  fs.mkdirSync(path.dirname(TARGET_ICO), { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-shelf-icon-"));

  try {
    const pngBuffers = process.platform === "win32"
      ? renderPngSizesWithPowerShell(tempDir)
      : [source];

    fs.writeFileSync(TARGET_ICO, createIco(pngBuffers));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`Created ${path.relative(ROOT_DIR, TARGET_ICO)}`);
  console.log(`Included sizes: ${readIcoSizes(TARGET_ICO).join(", ")}`);
}

function ensureSourcePng() {
  if (fs.existsSync(SOURCE_PNG)) return;
  if (!fs.existsSync(FALLBACK_SOURCE_PNG)) {
    throw new Error(`Icon source not found: ${SOURCE_PNG}`);
  }

  fs.copyFileSync(FALLBACK_SOURCE_PNG, SOURCE_PNG);
  console.log(`Created source PNG from ${path.relative(ROOT_DIR, FALLBACK_SOURCE_PNG)}`);
}

function renderPngSizesWithPowerShell(tempDir) {
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$source = $env:PULSE_SHELF_ICON_SOURCE
$output = $env:PULSE_SHELF_ICON_TEMP
$sizes = $env:PULSE_SHELF_ICON_SIZES -split "," | ForEach-Object { [int]$_ }
$paddingRatio = [double]$env:PULSE_SHELF_ICON_PADDING
$image = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)

      $maxDraw = $size * (1 - ($paddingRatio * 2))
      $scale = [Math]::Min($maxDraw / $image.Width, $maxDraw / $image.Height)
      $drawWidth = [Math]::Max(1, [Math]::Round($image.Width * $scale))
      $drawHeight = [Math]::Max(1, [Math]::Round($image.Height * $scale))
      $left = [Math]::Round(($size - $drawWidth) / 2)
      $top = [Math]::Round(($size - $drawHeight) / 2)
      $graphics.DrawImage($image, $left, $top, $drawWidth, $drawHeight)

      $target = [System.IO.Path]::Combine($output, "$size.png")
      $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $image.Dispose()
}
`;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SHELF_ICON_SOURCE: SOURCE_PNG,
        PULSE_SHELF_ICON_TEMP: tempDir,
        PULSE_SHELF_ICON_SIZES: ICON_SIZES.join(","),
        PULSE_SHELF_ICON_PADDING: String(PADDING_RATIO),
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr ||
        result.stdout ||
        result.error?.message ||
        `PowerShell icon generation failed with status ${result.status}`,
    );
  }

  return ICON_SIZES.map((size) => {
    const pngPath = path.join(tempDir, `${size}.png`);
    const png = fs.readFileSync(pngPath);
    assertPng(png, pngPath);
    return png;
  });
}

function createIco(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  const entries = [];
  let imageOffset = header.length + pngBuffers.length * 16;

  pngBuffers.forEach((png) => {
    const { width, height } = getPngSize(png);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += png.length;
    entries.push(entry);
  });

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

function readIcoSizes(icoPath) {
  const ico = fs.readFileSync(icoPath);
  const count = ico.readUInt16LE(4);
  const sizes = [];

  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = ico[offset] || 256;
    const height = ico[offset + 1] || 256;
    sizes.push(`${width}x${height}`);
  }

  return sizes;
}

function assertPng(buffer, filePath) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`File is not a PNG: ${filePath}`);
  }
}

function getPngSize(buffer) {
  assertPng(buffer, "PNG buffer");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

main();
