# crowd-line-counting

`web-crowd-detection-utils` の全モジュールを使用したフル構成サンプル
動画ファイル上で人物を検出・追跡し、画面に引いたライン上を行き来する人数を方向別にカウントする

`yolo-bytetrack-video` を拡張し、`background`（静止物の抑制）と `line-crossing`（ライン通過カウント）を追加した構成

さらに、このサンプルは**パイプライン全体を Web Worker 上で実行し、オーバーレイ描画を `OffscreenCanvas` で行う**応用構成
推論・追跡・計数・描画をすべてメインスレッドの外に出すことで、UI の応答性を保つ
他のサンプル（`yolo-webcam` / `yolo-bytetrack-video`）はメインスレッドで動作するシンプル構成として維持している

## 使用しているサブパス

| サブパス | 役割 |
| --- | --- |
| `onnx` | バックエンド選択（WebGPU / WASM）。`yolo` 経由で利用 |
| `yolo` | 人物検出（postprocess は `format: "auto"`、person クラスのみ） |
| `source` | レターボックスキャプチャ（`createLetterboxCapturer`）と逆変換（`reverseLetterboxBoxes`） |
| `background` | `BackgroundSubtractor` で静止領域の検出を抑制（トグル可能） |
| `bytetrack` | `BYTETracker` で安定した track ID を付与 |
| `line-crossing` | `LineCrossingCounter` でライン通過を方向別に集計 |

## パイプライン（`src/worker.ts`）

1. `source` — フレームを `INPUT_SIZE`（640）へレターボックスキャプチャ
2. `yolo` (+ `onnx`) — モデル入力空間で人物を検出
3. `background` — 静止領域の検出スコアを減衰させ、しきい値で除外（トグル可能）
4. `source` — レターボックスを逆変換してソース空間へ戻す
5. `bytetrack` — 安定した track ID を付与
6. `line-crossing` — 各 track の足元（バウンディングボックス下端中央）をアンカー点として、ライン通過を `forward` / `backward` に集計

> ライン（`Line`）と追跡点は同一座標空間（ソース空間 = 動画の解像度）で扱う
> `LineCrossingCounter` はスケーリングを行わないため、ラインと点の座標空間を一致させる必要がある

## アーキテクチャ（Web Worker + OffscreenCanvas）

| ファイル | スレッド | 役割 |
| --- | --- | --- |
| `src/App.tsx` | メイン | UI・状態管理。`<canvas>` を `transferControlToOffscreen()` で Worker に委譲し、`<video>` のフレームを `createImageBitmap()` で取得して転送する。ライン描画のポインタ操作のみメインで処理 |
| `src/worker.ts` | Worker | モデル読込・推論・追跡・計数、および委譲された `OffscreenCanvas` へのオーバーレイ描画 |
| `src/protocol.ts` | 共有 | メイン ⇔ Worker のメッセージ型 |
| `src/overlay.ts` | 共有 | 描画ヘルパー（Worker 側で `OffscreenCanvas` に描画。`clientToCanvas` のみメインで使用） |

ポイント:

- Worker 内には DOM が無いため、`source` の `createLetterboxCapturer` が内部スクラッチに **`OffscreenCanvas` を自動選択**する（パッケージ側の対応による）
- フレームは「Worker が処理中なら送らない」バックプレッシャ方式でドロップし、キューの肥大化を防ぐ
- `transferControlToOffscreen()` はキャンバスごとに一度しか呼べないため、Worker 生成とキャンバス委譲は ref ガードで1回に限定（React StrictMode の二重実行対策）
- `OffscreenCanvas` と WASM マルチスレッドのため、`vite.config.ts` で COOP/COEP ヘッダを設定済み

## ラインの操作

- 動画を読み込むと、水平中央に縦のラインが既定で配置される
- **Draw line** を押し、キャンバス上を2点クリックするとラインを引き直せる（1点目クリック→マウス移動でプレビュー→2点目クリックで確定）
- ラインの**緑の矢印**が `forward` 側を示す
  `forward` / `backward` はライン描画方向（p1→p2）基準であり、画面の左右ではない
  向きを反転したい場合は端点を逆順に引き直す
- **Reset counts** でカウントのみをゼロに、**Clear line** でラインを削除

## トグル

- **Background suppression** — `BackgroundSubtractor` による静止物抑制
  ポスターやマネキン等の誤検出を抑える。ただし長時間静止した人物も背景に吸収されうる（`alpha` を参照）
- **Crossing assist** — `LineCrossingCounter` の rescue / cooldown
  tracker の ID 切り替わりや、ライン上での往復ジッターによる重複カウントを補正する

## 環境

- Node.js >= 20 / pnpm
- YOLO の ONNX モデルファイル（既定は YOLO26n）
  セットアップ手順は後述。エクスポートに [`uv`](https://docs.astral.sh/uv/) を使用
- WebGPU もしくは WASM が利用できるブラウザ

## モデルセットアップ（YOLO26n）

アプリは起動時に `public/models/yolo26n.onnx` をfetchする

```sh
mkdir -p public/models
cd public/models
uv run --no-project --with ultralytics yolo export model=yolo26n.pt format=onnx imgsz=640 simplify=True
cd ../..
```

別バージョン（v8 / v11）を使う場合は同様にエクスポートして `public/models/` に配置し、
`src/App.tsx` の `MODEL_URL` を書き換える

## 起動手順

### 初期セットアップ

```sh
cd /path/to/web-crowd-detection-utils
pnpm install   # workspace 全体をインストール
pnpm build     # 親パッケージの dist/ を生成（初回のみ）
```

モデルセットアップ（前項参照）: `example/crowd-line-counting/public/models/yolo26n.onnx` を生成

### 起動

```sh
pnpm --filter @example/crowd-line-counting dev
```

または

```sh
cd example/crowd-line-counting && pnpm dev
```

## 設定

- モデル URL: `src/App.tsx` の `MODEL_URL`
- 入力解像度・しきい値・抑制係数: `src/worker.ts` の `INPUT_SIZE` / `DETECT_CONF` / `SUPPRESS_FACTOR`
- 背景モデルのチューニング: `new BackgroundSubtractor({ alpha, diffThreshold, minForegroundRatio })`
- crossing-assist のチューニング: `counter.update(points, lines, { assist: { rescueDistance, rescueFrames, cooldownFrames } })`
