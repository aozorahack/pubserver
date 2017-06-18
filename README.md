# pubserver
Prototype of Aozora-bunko package management server prototype

青空文庫の書籍パッケージを受け取り、配布するためのサーバのプロトタイプです

## 動かし方

### 前提条件
* MongoDB (2.6と3.0で確認しています)
* foreman (`gem install foreman`)


### コマンドラインでの起動
```
npm install
grunt coffee
foreman start web
```

### 環境変数

* `AOZORA_MONGODB_CREDENTIAL` MongoDBにアクセスするユーザ名・パスワード "*username*:*password*@" (default: "")
* `AOZORA_MONGODB_HOST` MongoDBのホスト名 (default: "localhost")
* `AOZORA_MONGODB_PORT` MongoDBのポート番号 (default: 27017)
* `PORT` pubserverの待ち受けポート番号 (default: 5000)



## ブラウザからのアクセス

- 新規登録作品のリスト http://www.aozorahack.net/books/whatsnew.html


## APIアクセス方法

以下は heroku.com で仮稼働しているプロトタイプサーバのURLです。
ローカルで動かす時にはホスト名を "localhost:5000"で適宜読み替えてください。

#### 本のリストの取得
```
curl http://www.aozorahack.net/api/v0.1/books
```

追加パラメータ
 - `title`: タイトル名でのフィルタ
 - `author`: 著者名でのフィルタ
 - `fields`: 取得する属性を指定
 - `limit`: 取得するアイテム数を制限
 - `skip`: 指定した分のアイテムをスキップしてそれ以降を取得
 - `after`: release_dateがこの日付よりも新しいモノのみを返す(YYYY-MM-DD)

#### 個別の本の情報の取得
```
curl http://www.aozorahack.net/api/v0.1/books/{book_id}
```

#### 本のカードを取得
```
curl http://www.aozorahack.net/api/v0.1/books/{book_id}/card
```

#### 本の中身をテキストで取得
```
curl http://www.aozorahack.net/api/v0.1/books/{book_id}/content?format=txt
```

#### 本の中身をhtmlで取得
```
curl http://www.aozorahack.net/api/v0.1/books/{book_id}/content?format=html
```

#### 本の情報をアップロード
```
curl -Fpackage=@{package_file} http://www.aozorahack.net/api/v0.1/books
```

`package_file`はaozora.txtとaozora.jsonが含まれるzipファイル。

#### 人物情報のリストの取得
```
curl http://www.aozorahack.net/api/v0.1/persons
```

追加パラメータ
 - `name`: 著者名でのフィルタ


#### 個別の人物の情報の取得
```
curl http://www.aozorahack.net/api/v0.1/persons/{person_id}
```

#### 工作員情報のリストの取得
```
curl http://www.aozorahack.net/api/v0.1/workers
```

#### 個別の工作員の情報の取得
```
curl http://www.aozorahack.net/api/v0.1/workers/{worker_id}
```

## 仕様
* [RAML](http://raml.org/)で記述してみたAPI仕様が[ここ](./spec/pubserver.raml)にあります

## DBにデータ登録するためのスクリプト

#### 書籍情報取得
https://github.com/aozorabunko/aozorabunko/raw/master/index_pages/list_person_all_extended_utf8.zip をダウンロード、そこに含まれるCSVファイルから情報取得し、DBに投入。
```
npm install -g coffee
coffee scraper/getbooks.coffee
```

#### 人物情報、工作員情報取得

http//reception<span></span>.aozora.gr.jp/{pidlist|widlist}.php からダウンロードしたHTMLファイルをscrapingしてDBに投入。結果は上記のAPIから取得できる。

```
npm install -g coffee
coffee scraper/getids.coffee
```
