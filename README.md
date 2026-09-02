# Media Stream Bridge

Firefoxで閲覧中のページが利用するストリーム配信を検出し、ローカルへ保存するための個人向けツール。

開発者ツールからストリームURLを探し、ターミナルでffmpegを実行する現在の手作業を、Firefox上の簡単な操作へまとめる。

## ステータス

初期実装段階。閲覧中のタブで利用するHLSストリームを検出し、PopupからmacOSのNative Hostを通じて保存できる。保存中、完了、失敗、キャンセルの状態と結果もPopupで確認できる。「保存」はダウンロード内の既定保存先とランダムID付きファイル名を使い、「設定して保存」では今回に限り拡張子を省略できるファイル名と、ムービーまたはダウンロードの保存先を選べる。画質の設定は後続で扱う。

## 解決したい問題

現在、ストリームを保存するには次の操作が必要になる。

1. Firefoxでストリームを再生するページを開く
2. 開発者ツールのネットワークタブを開く
3. 対象のストリームURLを探してコピーする
4. ターミナルでffmpegへURLを渡す
5. 保存結果を確認する

このツールは、ストリームの検出、選択、保存開始、保存状態と結果の確認をFirefox拡張から行えるようにする。

## 実現したい操作

```text
ページを開く
  → Firefox拡張を開く
  → 検出されたストリームを確認または選択する
  → 保存を開始する
  → 保存状態と結果を確認する
```

通常は一つのページに主要な動画が一つあると想定する。論理的なストリーム候補を一つに特定できた場合だけ自動選択し、複数候補が残る場合は利用者が選択する。サイト固有の判定処理は持たない。

保存操作は次の二つを想定する。

- 保存: あらかじめ決めた保存先、画質、ファイル名の設定を使用する
- 設定して保存: 今回の保存に限り設定を確認または変更する

デフォルト設定や「設定して保存」の詳細は、後続の到達点で決める。

## 対象範囲

初期版では、次を対象とする。

- Firefox
- DRMで保護されていないHLS VOD（`.m3u8`）
- URL単体をffmpegへ渡して取得できるストリーム
- マスタープレイリストから取得できる画質候補
- ffmpegによるローカルファイルへの保存

初期版では、次を対象外とする。

- Firefox以外のブラウザ
- サイト固有の検出・選択処理
- Cookie、`Authorization`、`Referer`など、ブラウザの認証状態や追加HTTPヘッダーの引き継ぎ
- DRMの解除、認証やアクセス制御の回避
- MPEG-DASHとライブストリーム
- ブラウザだけで保存できる直接配信のMP4やWebM

対象外の機能は、必要性が判明した時点で改めて検討する。

## 安全性

- 署名や認証情報を含む可能性があるため、ストリームの完全なURLを永続ログへ残さない
- Firefox拡張から任意のffmpeg引数を渡さず、URL、ファイル名、画質など必要な項目だけを渡す
- URL単体で取得できない場合は、認証情報を自動的に探索または転送せず、取得できなかったことを表示する

## 基本構成

コンポーネントの境界と責務は [`docs/design/architecture.md`](docs/design/architecture.md) に記載する。設計は現時点の仮説であり、実装と検証で得られた事実に応じて見直す。

## macOS Native Host の開発用登録

Node.js と `ffmpeg` を利用可能にしたうえで、リポジトリのルートでビルドしてから登録する。

```sh
npm run build
node scripts/install-native-host.mjs
```

このスクリプトは `~/Library/Application Support/Mozilla/NativeMessagingHosts/` に、固定した拡張IDだけを許可する manifest を作成する。あわせて `~/Library/Application Support/Media Stream Bridge/` に、実行時の `PATH` に依存しないNode.jsとffmpegの絶対パスを固定したランチャーを生成する。通常の保存では Host は `~/Downloads/Media Stream Bridge/` にランダムID付きの `.mp4` を保存する。設定して保存では単一のファイル名を指定でき、`.mp4` がなければ自動で付与する。今回に限り `~/Movies/Media Stream Bridge/` または `~/Downloads/Media Stream Bridge/` を選べる。指定名が無効または同名のファイルが既に存在する場合は保存せず、既存ファイルを上書きしない。登録後は拡張機能を再読み込みする。

## Firefox 開発起動

```sh
npm run start:firefox
```

このコマンドは Firefox Developer Edition を明示的に使用し、`web-ext` が作成する一時プロファイルへ拡張を読み込む。通常利用の Firefox アプリケーションとプロファイルは使わない。

## ドキュメント

- [`docs/roadmap.md`](docs/roadmap.md): 初期版完成までの到達点と現在地
- [`docs/development.md`](docs/development.md): 開発時の判断と検証の方針
- [`docs/design/architecture.md`](docs/design/architecture.md): 初期実装のコンポーネント境界と責務
- 設計、契約、重要な判断は、必要になった時点で `docs/` 以下へ追加する
