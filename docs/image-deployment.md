# イメージによるNAS運用

対象はUGREEN DXP8800 Plus（linux/amd64）。Git、Node.js、pnpm、ソースコード、NAS内ビルドは不要です。Docker Compose v2（`up --wait` と `--wait-timeout` 対応）、POSIXシェル、tar、一般的なLinuxコマンドを使用します。

## 公開の流れ

このforkのmainへマージするとCIが動きます。テスト、デモビルド、Dockerビルド、Web E2E、更新テストがすべて成功した場合のみ、`publish-images` がGHCRへWebとcrawlerのlinux/amd64イメージを公開します。mainを選択してCIのRun workflowから手動実行することもできます。PRからは公開しません。fork以外では公開ジョブをスキップします。

GHCRの名前は `ghcr.io/<owner>/<repository>-web` と `ghcr.io/<owner>/<repository>-crawler`。タグにコミットSHA・run ID・attemptを含め、再実行で既存リリースを書き換えません。両方のdigest取得後に配布物を作り、GitHub Releaseへアップロード完了後に公開します。一方が失敗すると通常のReleaseは作られません。途中のイメージ・buildcache・draft Releaseは更新対象にしません。

GitHub Actionsをforkで有効化し、ActionsのポリシーがGITHUB_TOKENによるpackages/contentsの書き込みを許可することを確認してください。新規GHCRパッケージは通常privateです。パッケージ設定でこのリポジトリのActionsアクセスを確認し、公開範囲は運用者が選択します。ワークフローは公開範囲を自動変更しません。

privateのまま使う場合、NASでイメージを取得するアカウントにパッケージの読み取り権限を付け、`read:packages` のPAT（classic）を使って `sudo docker login ghcr.io -u <registry-user>` を実行します。パスワードの入力欄にPATを入力してください。sudoで更新する場合、sudo側のDocker認証情報が必要です。publicパッケージのpullは認証不要です。

## 初回移行

1. GitHub Releasesから対象の `images-<sha>-<run>-<attempt>` を選び、`deployment.tar.gz` と `deployment.tar.gz.sha256` を管理端末へダウンロードします。SHA-256を確認します。Linuxは `sha256sum -c deployment.tar.gz.sha256`、Macは `shasum -a 256 -c deployment.tar.gz.sha256` を使用できます。
2. アーカイブを展開し、NASの既存インストールディレクトリ内の `releases/<release-id>/` にSMB等でコピーします。展開物は `compose.yml`、`release.env`、`update.sh`、`.env.example`、`README.md` の5ファイルです。既存の `.env` をテンプレートで上書きしないでください。
3. 現在のComposeプロジェクト名を `sudo docker compose ls` で確認します。元のディレクトリで `sudo docker compose ps` も確認し、更新対象を特定します。プロジェクト名の変更は認証用named volumeの変更につながるため、必ず既存名を引き継ぎます。
4. インストールディレクトリ直下の `data/`、`secrets/cloudflared-token`、`.env` を維持します。`HOST_UID`/`HOST_GID` は既存値を使用し、各コンテナがdataを読み書きし、トークンを読み取れることを確認します。`.env` は600、トークンは400を基本とします。crawler認証状態は既存の `<project>_crawler_auth_state` に保持されます。独自のvolume名やマウント先を設定している場合は、配布Composeを既存構成と照合してから移行してください。
5. crawler実行中でない時間帯に、対象Releaseのスクリプトを実行します。以下のパスとプロジェクト名は例です。

```sh
sudo sh /volume1/docker/mf-dashboard/releases/<release-id>/update.sh \
  /volume1/docker/mf-dashboard <existing-compose-project>
```

スクリプトはpull後にcrawlerの実行状態を確認し、実行中ならサービスを止めず終了します。その後Tunnel・crawler・Webを停止（猶予600秒）し、DBを含むdataディレクトリ全体をバックアップします。直前に定期実行が始まる可能性があるため、定期実行時刻の直前を避けてください。更新中は一時的に閲覧できなくなります。

対象イメージで毎回新しい一時migrateコンテナを実行し、成功した場合だけWebとcrawlerを再作成します。WebのHTTP応答とcrawlerの認証付きstatus APIによるhealthcheckが通ってからTunnelを起動します。最後に現在のReleaseのパスを `.image-release` に記録します。外部のCloudflare/Google認証や実クロールの成功はhealthcheckには含まれません。

初回移行後も、動作確認が済むまで以前のComposeとローカルイメージを保存してください。元のソース用Composeからの `up` は旧イメージに戻す可能性があるため、以降はRelease側のComposeを使用します。

## 起動時設定

公開イメージはドメイン直下（base pathなし）専用です。`NEXT_PUBLIC_BASE_PATH` が空でない設定は更新スクリプトで拒否します。サブパス運用には、そのbase pathを指定した独自ビルドが必要です。

`DASHBOARD_URL`、Cloudflare Accessの設定、AI、Slack、1PasswordなどはNASの `.env` から実行時に渡します。GitHub Actionsに本番のシークレットを登録する必要はありません。Webのmetadataもリクエスト時のURLから作ります。

シミュレーターにはサーバー設定 `SIMULATOR_*` を使用できます。既存の `NEXT_PUBLIC_SIMULATOR_*` は配布Composeで同名の `SIMULATOR_*` に読み替えるため、移行時の一括変更は不要です。新しい名前が優先されます。例えば：

```dotenv
SIMULATOR_ANNUAL_RETURN_RATE=5
SIMULATOR_INFLATION_RATE=2
SIMULATOR_WITHDRAWAL_MODE=amount
```

年齢・毎月の積立額・積立期間・取崩し設定・年金等も同じ接尾辞を使います。初期投資額は従来どおりDBの投資信託合計が優先され、`SIMULATOR_INITIAL_AMOUNT` は使用しません。設定値は認証後の画面描画に必要な値だけがブラウザへ渡され、公開イメージに埋め込まれません。

## 日常の更新と確認

新しいReleaseを別ディレクトリに展開し、同じ更新コマンドを実行します。イメージはReleaseに記録されたdigestで指定するため、latestタグの変化に追従しません。同じReleaseでの再実行も可能です。rootの環境変数だけを変更した場合も同じスクリプトで再作成できます。

状態・ログの確認例：

```sh
sudo docker compose --project-directory /volume1/docker/mf-dashboard \
  --project-name <existing-compose-project> \
  --env-file /volume1/docker/mf-dashboard/.env \
  --env-file /volume1/docker/mf-dashboard/releases/<release-id>/release.env \
  -f /volume1/docker/mf-dashboard/releases/<release-id>/compose.yml ps
```

同じ引数で `logs --tail=100 web crawler cloudflared` を確認できます。ログを共有する際は実データ・識別情報を除きます。dashboardの認証、保存済み認証状態、定期更新、通知、AI結果の更新日時を確認してください。

## 失敗と復旧

更新履歴は `backups/<UTC日時>-<PID>/` に保存されます。内容は `data.tar`、更新時の `.env`、プロジェクト名、前回Releaseのパス（移行済みの場合）、初回移行元のCompose（存在する場合）です。バックアップには機密情報・個人データが含まれるため、公開やソース同期の対象にせず、アクセス制限付きの別媒体にも保存してください。自動削除は行いません。保存済み認証状態のvolumeは更新処理で削除・変更せず引き継ぎます。NAS自体の障害に備える場合は、このvolumeとsecretsも別途バックアップしてください。

pullや実行状態確認での失敗は稼働中サービスに影響しません。停止後のマイグレーション・healthcheck失敗ではアプリを停止したままにし、古いイメージを自動起動しません。表示されたバックアップ先と原因を確認し、修正後に同じReleaseの更新スクリプトを再実行できます。強制終了やNAS再起動で `.image-update-lock` が残った場合は、更新プロセスが残っていないことを確認してから空ディレクトリを `rmdir` で除去します。

前のReleaseへ戻す場合：

1. DBスキーマの後方互換性を確認します。互換性がある場合は前のReleaseの更新スクリプトを実行できます。
2. 互換性がない、または不明な場合はTunnel・Web・crawlerを停止します。上記Compose引数で `stop -t 600 cloudflared crawler web` を使います。
3. 現在のdataディレクトリを別名へ退避し、対象の更新前バックアップの `data.tar` をインストールディレクトリへ展開します。既存dataへの重ね展開は避け、WAL/SHMもバックアップと同じ組み合わせに戻します。バックアップ後の取得データや手動編集はこのDB復元で巻き戻るため、退避データを保持します。
4. 前のReleaseに対応する設定を復元し、前のReleaseの更新スクリプトを実行します。バックアップの `.env` は更新開始時点の値です。設定を先に変更した場合は旧値を別途保存しておいてください。
5. 初回移行の切戻しは、復元したDB・旧設定と、保存しておいたソース用Compose・旧ローカルイメージを使用します。`--no-build` で起動し、NASで再ビルドしないでください。

通常更新・復旧とも `down --volumes` は使用しません。

## 検証方針

信頼性は更新の正常・失敗・再実行・復旧の状態遷移、セキュリティは除外対象の匿名マーカーと配布物の許可リスト、柔軟性は異なる実行時URLとUID/GID、保守性はdigestによるバージョン追跡で検証します。公開判定はイベント/ブランチ/CI結果の組み合わせを確認します。実アカウントのクロール・有料AI APIの呼び出しはCIで実行せず、NASでの最終確認とします。
