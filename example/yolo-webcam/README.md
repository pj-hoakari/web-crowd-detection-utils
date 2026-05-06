# yolo-webcam

`web-crowd-detection-utils`を使用してYOLOによる検出を行う最小構成サンプル

## 構成

- Vite + React + TypeScript
- `web-crowd-detection-utils` を pnpm workspace（`workspace:*`）でルートのパッケージから参照
- `onnxruntime-web` の WASM ファイルは Vite が自動でバンドル（後述）
- バックエンドは WebGPU が利用可能なら WebGPU、それ以外は WASM
  WebGPU の初期化に失敗した場合は WASM にフォールバック
- postprocessは `format: "auto"` を使用し、YOLOの出力を自動で解釈する

## 環境

- Node.js >= 20 / pnpm
- YOLO の ONNX モデルファイル（既定は YOLO26n）
  セットアップ手順は後述
  - モデルセットアップに [`uv`](https://docs.astral.sh/uv/)を使用
- Webcam が利用できるブラウザ

## モデルセットアップ（YOLO26n）

アプリは起動時に `public/models/yolo26n.onnx` をfetchする

### `.pt` を ONNX にエクスポート

```sh
mkdir -p public/models
cd public/models
uv run --no-project --with ultralytics yolo export model=yolo26n.pt format=onnx imgsz=640 simplify=True
cd ../..
```

または `public/models/export_model.py` を作って `uv run` で実行する

```python
# /// script
# dependencies = [
#   "ultralytics",
# ]
# ///

from ultralytics import YOLO

model = YOLO("yolo26n.pt")
model.export(format="onnx", imgsz=640, simplify=True)
```

```sh
uv run --no-project public/models/export_model.py
```

### 別バージョン（v8 / v11）のセットアップ

例: YOLOv8n
`--with ultralytics yolo export model=yolov8n.pt ...` でエクスポートし、`public/models/` に配置
`src/App.tsx` の `MODEL_URL` を `${BASE_URL}models/yolov8n.onnx` などに書き換える

## 起動手順

### 初期セットアップ

```sh
cd /path/to/web-crowd-detection-utils
pnpm install   # workspace 全体をインストール
pnpm build     # 親パッケージの dist/ を生成（初回のみ）
```

モデルセットアップ（前項参照）: `example/yolo-webcam/public/models/yolo26n.onnx` を生成

### 起動

```sh
pnpm --filter @example/yolo-webcam dev
```

または
```sh
cd example/yolo-webcam && pnpm dev
```

## 設定

- モデル URL: `src/App.tsx` の `MODEL_URL`
- 入力解像度: `src/detection.ts` の `INPUT_SIZE`（既定 640）
- 出力フォーマット: `createYoloDetector({ postprocess: { format: ... } })`
  （既定 `"auto"`，`"end-to-end"` / `"standard"` / `"end-to-end-transposed"` / `"standard-transposed"`が指定可能）
- 信頼度しきい値・クラスフィルタ: `createYoloDetector` の `postprocess` オプション
  （既定: `confThreshold: 0.15`, `classFilter: [0]`（person））
