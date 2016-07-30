#
# Copyright 2015 Kenichi Sato
#
AdmZip = require 'adm-zip'
parse = require 'csv-parse'
async = require 'async'
request = require 'request'

mongodb = require 'mongodb'
MongoClient = mongodb.MongoClient

mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || ''
mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost'
mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017'
mongo_url = "mongodb://#{mongodb_credential}#{mongodb_host}:#{mongodb_port}/aozora"

list_url_base = 'https://github.com/aozorabunko/aozorabunko/raw/master/index_pages/'
listfile_inp = 'list_inp_person_all_utf8.zip'
list_url_pub = 'list_person_all_extended_utf8.zip'

person_extended_attrs = [
  'book_id',
  'title',
  'title_yomi',
  'title_sort',
  'subtitle',
  'subtitle_yomi',
  'original_title',
  'first_appearance',
  'ndc_code',
  'font_kana_type',
  'copyright',
  'release_date',
  'last_modified',
  'card_url',
  'person_id',
  'last_name',
  'first_name',
  'last_name_yomi',
  'first_name_yomi',
  'last_name_sort',
  'first_name_sort',
  'last_name_roman',
  'first_name_roman',
  'role',
  'date_of_birth',
  'date_of_death',
  'author_copyright',
  'base_book_1',
  'base_book_1_publisher',
  'base_book_1_1st_edition'
  'base_book_1_edition_input',
  'base_book_1_eidtion_proofing',
  'base_book_1_parent',
  'base_book_1_parent_publisher',
  'base_book_1_parent_1st_edition',
  'base_book_2',
  'base_book_2_publisher',
  'base_book_2_1st_edition',
  'base_book_2_edition_input',
  'base_book_2_eidtion_proofing',
  'base_book_2_parent',
  'base_book_2_parent_publisher',
  'base_book_2_parent_1st_edition',
  'input',
  'proofing',
  'text_url',
  'text_last_modified',
  'text_encoding',
  'text_charset',
  'text_updated',
  'html_url',
  'html_last_modified',
  'html_encoding',
  'html_charset',
  'html_updated'
  ]


role_map =
  '著者': 'authors'
  '翻訳者': 'translators'
  '編者': 'editors'
  '校訂者': 'revisers'

get_bookobj = (entry, cb)->
  book = {}
  role = null
  person = {}

  person_extended_attrs.forEach (e,i)->
    value = entry[i]
    if value != ''
      if e in ['book_id', 'person_id', 'text_updated', 'html_updated']
        value = parseInt value
      else if e in ['copyright', 'author_copyright']
        value = value != 'なし'
      else if e in ['release_date', 'last_modified', 'date_of_birth', 'date_of_death',
                    'text_last_modified', 'html_last_modified']
        value = new Date value

      if e in ['person_id', 'first_name', 'last_name', 'last_name_yomi', 'first_name_yomi',
               'last_name_sort', 'first_name_sort', 'last_name_roman', 'first_name_roman',
               'date_of_birth', 'date_of_death', 'author_copyright']
        person[e] = value
        return
      else if e is 'role'
        role = role_map[value]
        if not role
          console.log value
        return

      book[e] = value

  cb book, role, person

MongoClient.connect mongo_url, (err, db)->
  if err
    console.log err
    return -1
  db = db
  books = db.collection('books')
  persons = db.collection('persons')

  # list_url_base = 'http://localhost:8000/'
  # list_url_pub = 'list_person_all_extended_utf8_short.zip'
  request.get list_url_base + list_url_pub, {encoding: null}, (err, resp, body)->
    if err
      return -1
    zip = AdmZip body
    entries = zip.getEntries()
    if entries.length != 1
      return -1
    buf = zip.readFile entries[0]
    parse buf, (err, data)->
      books.findOne {}, {fields: {release_date: 1}, sort: {release_date: -1}}, (err, item)->
        if err or item is null
          last_release_date = new Date '1970-01-01'
        else
          last_release_date = item.release_date
        updated = data[1..].filter (entry)->
          release_date = new Date entry[11]
          return last_release_date < release_date
        console.log "#{updated.length} entries are updated"
        if updated.length > 0
          books_batch_list = {}
          persons_batch_list = {}
          async.eachSeries updated, (entry, cb)->
            async.setImmediate (entry, cb)->
              get_bookobj entry, (book, role, person)->
                if not books_batch_list[book.book_id]
                  books_batch_list[book.book_id] = book
                if not books_batch_list[book.book_id][role]
                  books_batch_list[book.book_id][role] = []
                books_batch_list[book.book_id][role].push
                  person_id: person.person_id
                  last_name: person.last_name
                  first_name: person.first_name
                  full_name: person.last_name + person.first_name
                if not persons_batch_list[person.person_id]
                  persons_batch_list[person.person_id] = person
                cb null,
            , entry, cb
          , (err)->
            if err
              console.log err
              return -1

            async.parallel [
              (cb)->
                books_batch = books.initializeUnorderedBulkOp()
                for book_id, book of books_batch_list
                  books_batch.find({book_id: book_id}).upsert().updateOne book
                books_batch.execute cb
              ,(cb)->
                persons_batch = persons.initializeUnorderedBulkOp()
                for person_id, person of persons_batch_list
                  persons_batch.find({person_id: person_id}).upsert().updateOne person
                persons_batch.execute cb
            ], (err, result)->
              if err
                console.log 'err', err
              db.close()
        else
          db.close()
