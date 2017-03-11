(function() {
  var AdmZip, DATA_LIFETIME, DEFAULT_LIMIT, FB_MESSENGER_VERIFY_TOKEN, GridStore, MongoClient, add_ogp, api_root, app, bodyParser, check_archive, compression, content_type, encodings, express, fs, get_from_cache, get_ogpcard, get_zipped, iconv, methodOverride, mongo_url, mongodb, mongodb_credential, mongodb_host, mongodb_port, morgan, re_or_str, redis, rel_to_abs_path, repo_backend, request, upload_content, upload_content_data, version, yaml, zlib;

  fs = require('fs');

  express = require('express');

  morgan = require('morgan');

  bodyParser = require('body-parser');

  methodOverride = require('method-override');

  compression = require('compression');

  mongodb = require('mongodb');

  AdmZip = require('adm-zip');

  yaml = require('js-yaml');

  request = require('request');

  zlib = require('zlib');

  redis = require('redis');

  iconv = require('iconv-lite');

  repo_backend = require('./repo_bitbucket');

  MongoClient = mongodb.MongoClient;

  GridStore = mongodb.GridStore;

  mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';

  mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';

  mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';

  mongo_url = "mongodb://" + mongodb_credential + mongodb_host + ":" + mongodb_port + "/aozora";

  DEFAULT_LIMIT = 100;

  DATA_LIFETIME = 3600;

  app = express();

  version = 'v0.1';

  api_root = '/api/' + version;

  app.use(express["static"](__dirname + '/../public'));

  app.use(morgan('dev'));

  app.use(bodyParser.urlencoded({
    extended: false
  }));

  app.use(bodyParser.json());

  app.use(methodOverride());

  app.use(compression());

  check_archive = function(path, cb) {
    var bookobj, data, err, error, textpath;
    try {
      data = fs.readFileSync(path + 'aozora.json');
    } catch (error) {
      err = error;
      if (err.code === 'ENOENT') {
        cb("Cannot find aozora.json\n");
      } else {
        cb(err);
      }
      return;
    }
    textpath = path + 'aozora.txt';
    if (!fs.existsSync(textpath)) {
      cb("Cannot find aozora.txt\n");
      return;
    }
    console.log(data);
    bookobj = yaml.safeLoad(data);
    console.log(bookobj);
    return cb(null, bookobj, textpath);
  };

  upload_content = function(db, book_id, source_file, cb) {
    var gs;
    gs = new GridStore(db, book_id, book_id + ".txt", 'w');
    return gs.writeFile(source_file, cb);
  };

  upload_content_data = function(rc, key, data, cb) {
    return zlib.deflate(data, function(err, zdata) {
      if (err) {
        return cb(err);
      } else {
        return rc.setex(key, DATA_LIFETIME, zdata, cb);
      }
    });
  };

  re_or_str = function(src) {
    if (src[0] === '/' && src.slice(-1) === '/') {
      return {
        "$in": [new RegExp(src.slice(1, -1))]
      };
    } else {
      return src;
    }
  };

  app.route(api_root + '/books').get(function(req, res) {
    var options, query;
    query = {};
    if (req.query.title) {
      query['title'] = re_or_str(req.query.title);
    }
    if (req.query.author) {
      query['authors.full_name'] = re_or_str(req.query.author);
    }
    if (req.query.after) {
      query['release_date'] = {
        "$gte": new Date(req.query.after)
      };
    }
    options = {
      sort: {
        release_date: -1
      },
      fields: {
        _id: 0
      }
    };
    if (req.query.fields) {
      req.query.fields.split(',').forEach(function(a) {
        return options.fields[a] = 1;
      });
    }
    if (req.query.limit) {
      options.limit = parseInt(req.query.limit);
    } else {
      options.limit = DEFAULT_LIMIT;
    }
    if (req.query.skip) {
      options.skip = parseInt(req.query.skip);
    }
    return app.my.books.find(query, options, function(err, items) {
      return items.toArray(function(err, docs) {
        if (err) {
          console.log(err);
          return res.status(500).end();
        } else {
          return res.json(docs);
        }
      });
    });
  }).post(function(req, res) {
    var path, pkg, zip;
    pkg = req.files["package"];
    if (!pkg) {
      return res.status(400).send("parameter package is not specified");
    }
    zip = new AdmZip(pkg.path);
    path = process.env.TMPDIR + '/' + pkg.name.split('.')[0] + '-unzip/';
    zip.extractAllTo(path);
    return check_archive(path, function(err, bookobj, source_file) {
      var book_id;
      if (err) {
        return res.status(400).send(err);
      }
      book_id = bookobj.id;
      return app.my.books.update({
        id: book_id
      }, bookobj, {
        upsert: true
      }, function(err, doc) {
        if (err) {
          console.log(err);
          return res.sendStatus(500);
        }
        return upload_content(app.my.db, book_id, source_file, function(err) {
          console.log(err);
          if (err) {
            console.log(err);
            return res.sendStatus(500);
          }
          res.location("/books/" + book_id);
          return res.sendStatus(201);
        });
      });
    });
  });

  app.route(api_root + '/books/:book_id').get(function(req, res) {
    var book_id;
    book_id = parseInt(req.params.book_id);
    return app.my.books.findOne({
      book_id: book_id
    }, {
      _id: 0
    }, function(err, doc) {
      if (err || doc === null) {
        console.log(err);
        return res.status(404).end();
      } else {
        return res.json(doc);
      }
    });
  });

  content_type = {
    'txt': 'text/plain; charset=shift_jis'
  };

  get_from_cache = function(my, book_id, get_file, ext, cb) {
    var key;
    key = "" + ext + book_id;
    return my.rc.get(key, function(err, result) {
      if (err || !result) {
        if (get_file) {
          return get_file(my, book_id, ext, function(err, data) {
            if (err) {
              return cb(err);
            } else {
              return upload_content_data(my.rc, key, data, function(err) {
                if (err) {
                  return cb(err);
                } else {
                  return cb(null, data);
                }
              });
            }
          });
        } else {
          return cb(err);
        }
      } else {
        return zlib.inflate(result, function(err, data) {
          if (err) {
            return cb(err);
          } else {
            return cb(null, data);
          }
        });
      }
    });
  };

  add_ogp = function(body, title, author) {
    var ogp_headers;
    ogp_headers = ['<head prefix="og: http://ogp.me/ns#">', '<meta name="twitter:card" content="summary" />', '<meta property="og:type" content="book">', '<meta property="og:image" content="http://www.aozora.gr.jp/images/top_logo.png">', '<meta property="og:image:type" content="image/png">', '<meta property="og:image:width" content="100">', '<meta property="og:image:height" content="100">', '<meta property="og:description" content="...">', "<meta property=\"og:title\" content=\"" + title + "(" + author + ")\""].join('\n');
    return body.replace(/<head>/, ogp_headers);
  };

  rel_to_abs_path = function(body, ext) {
    if (ext === 'card') {
      return body.replace(/\.\.\/\.\.\//g, 'http://www.aozora.gr.jp/').replace(/\.\.\//g, 'http://www.aozora.gr.jp/cards/');
    } else {
      return body.replace(/\.\.\/\.\.\//g, 'http://www.aozora.gr.jp/cards/');
    }
  };

  encodings = {
    'card': 'utf-8',
    'html': 'shift_jis'
  };

  get_ogpcard = function(my, book_id, ext, cb) {
    return my.books.findOne({
      book_id: book_id
    }, {
      card_url: 1,
      html_url: 1,
      title: 1,
      authors: 1
    }, function(err, doc) {
      if (err || doc === null) {
        cb(err);
        return;
      }
      console.log(doc[ext + "_url"]);
      return request.get(doc[ext + "_url"], {
        encoding: null,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': '*/*'
        }
      }, function(err, res, body) {
        var bodystr, encoding;
        if (err) {
          return cb(err);
        } else {
          encoding = encodings[ext];
          bodystr = iconv.decode(body, encoding);
          bodystr = add_ogp(bodystr, doc.title, doc.authors[0].full_name);
          bodystr = rel_to_abs_path(bodystr, ext);
          return cb(null, iconv.encode(bodystr, encodings[ext]));
        }
      });
    });
  };

  get_zipped = function(my, book_id, ext, cb) {
    return my.books.findOne({
      book_id: book_id
    }, {
      text_url: 1
    }, function(err, doc) {
      if (err || doc === null) {
        cb(err);
        return;
      }
      return request.get(doc.text_url, {
        encoding: null,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': '*/*'
        }
      }, function(err, res, body) {
        var entry, zip;
        if (err) {
          return cb(err);
        } else {
          zip = new AdmZip(body);
          entry = zip.getEntries()[0];
          return cb(null, zip.readFile(entry));
        }
      });
    });
  };

  app.route(api_root + '/books/:book_id/card').get(function(req, res) {
    var book_id;
    book_id = parseInt(req.params.book_id);
    return get_from_cache(app.my, book_id, get_ogpcard, 'card', function(err, result) {
      if (err) {
        console.log(err);
        return res.status(404).end();
      } else {
        res.set('Content-Type', 'text/html');
        return res.send(result);
      }
    });
  });

  app.route(api_root + '/books/:book_id/content').get(function(req, res) {
    var book_id, ext;
    book_id = parseInt(req.params.book_id);
    ext = req.query.format;
    if (ext === 'html') {
      return get_from_cache(app.my, book_id, get_ogpcard, 'html', function(err, result) {
        if (err) {
          console.log(err);
          return res.status(404).end();
        } else {
          res.set('Content-Type', 'text/html; charset=shift_jis');
          return res.send(result);
        }
      });
    } else {
      ext = 'txt';
      return get_from_cache(app.my, book_id, get_zipped, ext, function(err, result) {
        if (err) {
          console.log(err);
          return res.status(404).end();
        } else {
          res.set('Content-Type', content_type[ext] || 'application/octet-stream');
          return res.send(result);
        }
      });
    }
  });

  app.route(api_root + '/drafts').post(function(req, res) {
    var author, book_id, is_private, title;
    title = req.body.title;
    author = req.body.author;
    book_id = req.body.id;
    is_private = req.body["private"] === true;
    return repo_backend.init_repo(title, author, book_id, is_private, function(status, data) {
      if (data) {
        return res.status(status).json(data);
      } else {
        return res.sendStatus(status);
      }
    });
  });

  app.route(api_root + '/persons').get(function(req, res) {
    var query;
    query = {};
    if (req.query.name) {
      query['full_name'] = re_or_str(req.query.name);
    }
    return app.my.persons.find(query, {
      _id: 0
    }, function(err, items) {
      return items.toArray(function(err, docs) {
        if (err) {
          console.log(err);
          return res.status(500).end();
        } else {
          return res.json(docs);
        }
      });
    });
  });

  app.route(api_root + '/persons/:person_id').get(function(req, res) {
    var person_id;
    person_id = parseInt(req.params.person_id);
    return app.my.persons.findOne({
      person_id: person_id
    }, {
      _id: 0
    }, function(err, doc) {
      if (err || doc === null) {
        console.log(err);
        return res.status(404).end();
      } else {
        return res.json(doc);
      }
    });
  });

  app.route(api_root + '/workers').get(function(req, res) {
    var query;
    query = {};
    if (req.query.name) {
      query.name = re_or_str(req.query.name);
    }
    return app.my.workers.find(query, {
      _id: 0
    }, function(err, items) {
      return items.toArray(function(err, docs) {
        if (err) {
          console.log(err);
          return res.status(500).end();
        } else {
          return res.json(docs);
        }
      });
    });
  });

  app.route(api_root + '/workers/:worker_id').get(function(req, res) {
    var worker_id;
    worker_id = parseInt(req.params.worker_id);
    return app.my.workers.findOne({
      id: worker_id
    }, {
      _id: 0
    }, function(err, doc) {
      if (err || doc === null) {
        console.log(err);
        return res.status(404).end();
      } else {
        return res.json(doc);
      }
    });
  });

  FB_MESSENGER_VERIFY_TOKEN = process.env.FB_MESSENGER_VERIFY_TOKEN;

  app.route('/callback/:service').get(function(req, res) {
    if (req.params.service === 'fb') {
      console.dir(req.query);
      if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === FB_MESSENGER_VERIFY_TOKEN) {
        return res.send(req.query['hub.challenge']);
      } else {
        return res.status(401).send();
      }
    } else {
      return res.status(404).send();
    }
  }).post(function(req, res) {
    console.dir(req.body);
    return res.sendStatus(200);
  });

  MongoClient.connect(mongo_url, function(err, db) {
    var port;
    if (err) {
      console.log(err);
      return -1;
    }
    port = process.env.PORT || 5000;
    app.my = {};
    app.my.db = db;
    app.my.rc = redis.createClient({
      return_buffers: true
    });
    app.my.books = db.collection('books');
    app.my.authors = db.collection('authors');
    app.my.persons = db.collection('persons');
    app.my.workers = db.collection('workers');
    return app.listen(port, function() {
      return console.log("Magic happens on port " + port);
    });
  });

}).call(this);
