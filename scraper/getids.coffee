#
# Copyright 2015 Kenichi Sato
#
scraperjs = require 'scraperjs'
async = require 'async'

mongodb = require 'mongodb'
MongoClient = mongodb.MongoClient

mongodb = require 'mongodb'
mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || ''
mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost'
mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017'
mongo_url = "mongodb://#{mongodb_credential}#{mongodb_host}:#{mongodb_port}/aozora"

scrape_url = (idurl, cb)->
  scraperjs.StaticScraper.create idurl
  .scrape ($)->
    $("tr[valign]").map ->
      $row = $(this)
      ret =
        id: $row.find(':nth-child(1)').text().trim()
        name: $row.find(':nth-child(2)').text().trim().replace('　',' ')
    .get()
  , (items)->
      cb null, items[1...]


idurls =
#  'persons': 'http://reception.aozora.gr.jp/pidlist.php?page=1&pagerow=-1',
  'workers': 'http://reception.aozora.gr.jp/widlist.php?page=1&pagerow=-1'

MongoClient.connect mongo_url, (err, db)->
  if err
    console.log err
    return -1
   async.map Object.keys(idurls), (idname, cb)->
    collection = db.collection idname
    idurl = idurls[idname]
    console.log idurl
    scrape_url idurl, (err, results)->
      if err
        cb err
      async.map results, (result, cb2)->
        result.id = parseInt(result.id)
        collection.update {id: result.id}, result, {upsert: true}, cb2
      , (err, results2)->
        if err
          cb err
        else
          cb null, results2.length
  , (err, result)->
    if err
      console.log err
      return -1
    console.log result
    db.close()
