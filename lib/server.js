(function() {
  var AdmZip, DEFAULT_LIMIT, GridStore, MongoClient, api_root, app, bodyParser, check_archive, compression, content_type, express, fs, get_from_gs, get_zipped, methodOverride, mongo_url, mongodb, mongodb_credential, mongodb_host, mongodb_port, morgan, re_or_str, repo_backend, request, upload_content, upload_content_data, version, yaml, zlib;

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

  repo_backend = require('./repo_bitbucket');

  MongoClient = mongodb.MongoClient;

  GridStore = mongodb.GridStore;

  mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';

  mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';

  mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';

  mongo_url = "mongodb://" + mongodb_credential + mongodb_host + ":" + mongodb_port + "/aozora";

  DEFAULT_LIMIT = 100;

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

  upload_content_data = function(db, book_id, source, cb) {
    var gs;
    gs = new GridStore(db, book_id, book_id + ".txt", 'w');
    return gs.open(function(err, gs) {
      if (err) {
        cb(err);
        return;
      }
      return gs.write(source, function(err, gs) {
        if (err) {
          cb(err);
          return;
        }
        return gs.close(function(err) {
          return cb(err);
        });
      });
    });
  };

  re_or_str = function(src) {
    console.log(src);
    console.log(src[0]);
    console.log(src[-1]);
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
        console.log(doc);
        return res.json(doc);
      }
    });
  });

  content_type = {
    'txt': 'text/plain; charset=shift_jis'
  };

  get_from_gs = function(my, book_id, get_file, cb) {
    return GridStore.read(app.my.db, book_id + ".txt", function(err, result) {
      if (err) {
        if (get_file) {
          return get_file(my, book_id, function(err) {
            if (err) {
              return cb(err);
            } else {
              return get_from_gs(my, book_id, null, cb);
            }
          });
        } else {
          return cb(err);
        }
      } else {
        return cb(null, zlib.inflateSync(result));
      }
    });
  };

  get_zipped = function(my, book_id, cb) {
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
        var data, entry, zdata, zip;
        if (err) {
          cb(err);
          return;
        }
        zip = new AdmZip(body);
        entry = zip.getEntries()[0];
        data = zip.readFile(entry);
        zdata = zlib.deflateSync(data);
        return upload_content_data(my.db, book_id, zdata, function(err) {
          return cb(err);
        });
      });
    });
  };

  app.route(api_root + '/books/:book_id/content').get(function(req, res) {
    var book_id, ext;
    book_id = parseInt(req.params.book_id);
    ext = req.query.format;
    if (ext === 'html') {
      return app.my.books.findOne({
        book_id: book_id
      }, {
        html_url: 1
      }, function(err, doc) {
        if (err) {
          console.log(err);
          return res.status(404).end();
        } else {
          return res.redirect(doc.html_url);
        }
      });
    } else {
      ext = 'txt';
      return get_from_gs(app.my, book_id, get_zipped, function(err, result) {
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
        console.log(doc);
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
        console.log(doc);
        return res.json(doc);
      }
    });
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
    app.my.books = db.collection('books');
    app.my.authors = db.collection('authors');
    app.my.persons = db.collection('persons');
    app.my.workers = db.collection('workers');
    return app.listen(port, function() {
      return console.log("Magic happens on port " + port);
    });
  });

}).call(this);
