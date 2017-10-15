(function() {
  var MongoClient, async, idurls, mongo_url, mongodb, mongodb_credential, mongodb_host, mongodb_port, scrape_url, scraperjs;

  scraperjs = require('scraperjs');

  async = require('async');

  mongodb = require('mongodb');

  MongoClient = mongodb.MongoClient;

  mongodb = require('mongodb');

  mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';

  mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';

  mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';

  mongo_url = "mongodb://" + mongodb_credential + mongodb_host + ":" + mongodb_port + "/aozora";

  scrape_url = function(idurl, cb) {
    return scraperjs.StaticScraper.create(idurl).scrape(function($) {
      return $("tr[valign]").map(function() {
        var $row, ret;
        $row = $(this);
        return ret = {
          id: $row.find(':nth-child(1)').text().trim(),
          name: $row.find(':nth-child(2)').text().trim().replace('　', ' ')
        };
      }).get();
    }, function(items) {
      return cb(null, items.slice(1));
    });
  };

  idurls = {
    'workers': 'http://reception.aozora.gr.jp/widlist.php?page=1&pagerow=-1'
  };

  MongoClient.connect(mongo_url, function(err, db) {
    if (err) {
      console.log(err);
      return -1;
    }
    return async.map(Object.keys(idurls), function(idname, cb) {
      var collection, idurl;
      collection = db.collection(idname);
      idurl = idurls[idname];
      console.log(idurl);
      return scrape_url(idurl, function(err, results) {
        if (err) {
          cb(err);
        }
        return async.map(results, function(result, cb2) {
          result.id = parseInt(result.id);
          return collection.update({
            id: result.id
          }, result, {
            upsert: true
          }, cb2);
        }, function(err, results2) {
          if (err) {
            return cb(err);
          } else {
            return cb(null, results2.length);
          }
        });
      });
    }, function(err, result) {
      if (err) {
        console.log(err);
        return -1;
      }
      console.log(result);
      return db.close();
    });
  });

}).call(this);
