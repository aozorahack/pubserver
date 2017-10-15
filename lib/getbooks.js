(function() {
  var AdmZip, MongoClient, async, get_bookobj, list_url_base, list_url_pub, listfile_inp, mongo_url, mongodb, mongodb_credential, mongodb_host, mongodb_port, parse, person_extended_attrs, request, role_map;

  AdmZip = require('adm-zip');

  parse = require('csv-parse');

  async = require('async');

  request = require('request');

  mongodb = require('mongodb');

  MongoClient = mongodb.MongoClient;

  mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';

  mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';

  mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';

  mongo_url = "mongodb://" + mongodb_credential + mongodb_host + ":" + mongodb_port + "/aozora";

  list_url_base = 'https://github.com/aozorabunko/aozorabunko/raw/master/index_pages/';

  listfile_inp = 'list_inp_person_all_utf8.zip';

  list_url_pub = 'list_person_all_extended_utf8.zip';

  person_extended_attrs = ['book_id', 'title', 'title_yomi', 'title_sort', 'subtitle', 'subtitle_yomi', 'original_title', 'first_appearance', 'ndc_code', 'font_kana_type', 'copyright', 'release_date', 'last_modified', 'card_url', 'person_id', 'last_name', 'first_name', 'last_name_yomi', 'first_name_yomi', 'last_name_sort', 'first_name_sort', 'last_name_roman', 'first_name_roman', 'role', 'date_of_birth', 'date_of_death', 'author_copyright', 'base_book_1', 'base_book_1_publisher', 'base_book_1_1st_edition', 'base_book_1_edition_input', 'base_book_1_edition_proofing', 'base_book_1_parent', 'base_book_1_parent_publisher', 'base_book_1_parent_1st_edition', 'base_book_2', 'base_book_2_publisher', 'base_book_2_1st_edition', 'base_book_2_edition_input', 'base_book_2_edition_proofing', 'base_book_2_parent', 'base_book_2_parent_publisher', 'base_book_2_parent_1st_edition', 'input', 'proofing', 'text_url', 'text_last_modified', 'text_encoding', 'text_charset', 'text_updated', 'html_url', 'html_last_modified', 'html_encoding', 'html_charset', 'html_updated'];

  role_map = {
    '著者': 'authors',
    '翻訳者': 'translators',
    '編者': 'editors',
    '校訂者': 'revisers'
  };

  get_bookobj = function(entry, cb) {
    var book, person, role;
    book = {};
    role = null;
    person = {};
    person_extended_attrs.forEach(function(e, i) {
      var value;
      value = entry[i];
      if (value !== '') {
        if (e === 'book_id' || e === 'person_id' || e === 'text_updated' || e === 'html_updated') {
          value = parseInt(value);
        } else if (e === 'copyright' || e === 'author_copyright') {
          value = value !== 'なし';
        } else if (e === 'release_date' || e === 'last_modified' || e === 'date_of_birth' || e === 'date_of_death' || e === 'text_last_modified' || e === 'html_last_modified') {
          value = new Date(value);
        }
        if (e === 'person_id' || e === 'first_name' || e === 'last_name' || e === 'last_name_yomi' || e === 'first_name_yomi' || e === 'last_name_sort' || e === 'first_name_sort' || e === 'last_name_roman' || e === 'first_name_roman' || e === 'date_of_birth' || e === 'date_of_death' || e === 'author_copyright') {
          person[e] = value;
          return;
        } else if (e === 'role') {
          role = role_map[value];
          if (!role) {
            console.log(value);
          }
          return;
        }
        return book[e] = value;
      }
    });
    return cb(book, role, person);
  };

  MongoClient.connect(mongo_url, {
    connectTimeoutMS: 120000,
    socketTimeoutMS: 120000
  }, function(err, db) {
    var books, persons;
    if (err) {
      console.log(err);
      return -1;
    }
    db = db;
    books = db.collection('books');
    persons = db.collection('persons');
    return request.get(list_url_base + list_url_pub, {
      encoding: null
    }, function(err, resp, body) {
      var buf, entries, zip;
      if (err) {
        return -1;
      }
      zip = AdmZip(body);
      entries = zip.getEntries();
      if (entries.length !== 1) {
        return -1;
      }
      buf = zip.readFile(entries[0]);
      return parse(buf, function(err, data) {
        return books.findOne({}, {
          fields: {
            release_date: 1
          },
          sort: {
            release_date: -1
          }
        }, function(err, item) {
          var books_batch_list, last_release_date, persons_batch_list, updated;
          if (err || item === null) {
            last_release_date = new Date('1970-01-01');
          } else {
            last_release_date = item.release_date;
          }
          updated = data.slice(1).filter(function(entry) {
            var release_date;
            release_date = new Date(entry[11]);
            return last_release_date < release_date;
          });
          console.log(updated.length + " entries are updated");
          if (updated.length > 0) {
            books_batch_list = {};
            persons_batch_list = {};
            return async.eachSeries(updated, function(entry, cb) {
              return async.setImmediate(function(entry, cb) {
                return get_bookobj(entry, function(book, role, person) {
                  if (!books_batch_list[book.book_id]) {
                    books_batch_list[book.book_id] = book;
                  }
                  if (!books_batch_list[book.book_id][role]) {
                    books_batch_list[book.book_id][role] = [];
                  }
                  person.full_name = person.last_name + person.first_name;
                  books_batch_list[book.book_id][role].push({
                    person_id: person.person_id,
                    last_name: person.last_name,
                    first_name: person.first_name,
                    full_name: person.full_name
                  });
                  if (!persons_batch_list[person.person_id]) {
                    persons_batch_list[person.person_id] = person;
                  }
                  return cb(null);
                });
              }, entry, cb);
            }, function(err) {
              if (err) {
                console.log(err);
                return -1;
              }
              return async.parallel([
                function(cb) {
                  var book, book_id, books_batch;
                  books_batch = books.initializeUnorderedBulkOp();
                  for (book_id in books_batch_list) {
                    book = books_batch_list[book_id];
                    books_batch.find({
                      book_id: book_id
                    }).upsert().updateOne(book);
                  }
                  return books_batch.execute(cb);
                }, function(cb) {
                  var person, person_id, persons_batch;
                  persons_batch = persons.initializeUnorderedBulkOp();
                  for (person_id in persons_batch_list) {
                    person = persons_batch_list[person_id];
                    persons_batch.find({
                      person_id: person_id
                    }).upsert().updateOne(person);
                  }
                  return persons_batch.execute(cb);
                }
              ], function(err, result) {
                if (err) {
                  console.log('err', err);
                }
                return db.close();
              });
            });
          } else {
            return db.close();
          }
        });
      });
    });
  });

}).call(this);
