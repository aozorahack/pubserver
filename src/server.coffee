#
# Copyright 2015 Kenichi Sato
#
fs = require 'fs'
express = require 'express'
morgan = require 'morgan'
bodyParser = require 'body-parser'
methodOverride = require 'method-override'
compression = require 'compression'
multer = require 'multer'
mongodb = require 'mongodb'
AdmZip = require 'adm-zip'
yaml = require 'js-yaml'
request = require 'request'
zlib = require 'zlib'

repo_backend = require './repo_bitbucket'

MongoClient = mongodb.MongoClient
GridStore = mongodb.GridStore

mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || ''
mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost'
mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017'
mongo_url = "mongodb://#{mongodb_credential}#{mongodb_host}:#{mongodb_port}/aozora"

app = express();

version = 'v0.1'
api_root = '/api/' + version

app.use express.static __dirname + '/../public'
app.use morgan 'dev'
app.use bodyParser.urlencoded
  extended: false
app.use bodyParser.json()
app.use multer
  onError: (error, next)->
    console.log err
    next(error)
  # onFileUploadStart: (file, req, res)->
  #   console.log "#{file.fieldname} is starting ..."
  # onFileUploadData: (file, data, req, res)->
  #   console.log "#{data.length} of #{file.fieldname} arrived"
  # onFileUploadComplete: (file, req, res)->
  #   console.log "#{file.fieldname} uploaded to #{file.path}"
app.use methodOverride()
app.use compression()

#
# books
#
check_archive = (path, cb)->
  # check aozora json
  try
    data = fs.readFileSync path + 'aozora.json'
  catch err
    if err.code == 'ENOENT'
      cb "Cannot find aozora.json\n"
    else
      cb err
    return

  textpath = path + 'aozora.txt'
  if not fs.existsSync textpath
    cb "Cannot find aozora.txt\n"
    return

  console.log data
  bookobj = yaml.safeLoad data
  console.log bookobj
  cb null, bookobj, textpath

upload_content = (db, book_id, source_file, cb)->
  gs = new GridStore db, book_id, "#{book_id}.txt", 'w'
  gs.writeFile source_file, cb

upload_content_data = (db, book_id, source, cb)->
  gs = new GridStore db, book_id, "#{book_id}.txt", 'w'
  gs.open (err, gs)->
    if err
      cb err
      return
    gs.write source, (err, gs)->
        if err
          cb err
          return
        gs.close (err)->
          cb err

app.route api_root + '/books'
  .get (req, res)->
    query = {}
    if req.query.name
      query['title'] = req.query.name
    if req.query.author
      query['authors.full_name'] = {"$in": [new RegExp req.query.author]}
    if req.query.after
      query['release_date'] = {"$gte": new Date (req.query.after)}
    options =
      sort:
        release_date: -1
      fields:
        _id: 0
    if req.query.fields
      req.query.fields.split(',').forEach (a)->
        options.fields[a] = 1
    if req.query.limit
      options.limit = parseInt req.query.limit
    # console.log query, options
    app.my.books.find query, options, (err, items)->
      items.toArray (err, docs)->
        if err
          console.log err
          return res.status(500).end()
        else
          res.json docs
  .post (req, res)->
    pkg = req.files.package
    if not pkg
      return res.status(400).send "parameter package is not specified"
    # console.log pkg
    zip = new AdmZip pkg.path
    path = process.env.TMPDIR + '/' + pkg.name.split('.')[0] + '-unzip/'
    zip.extractAllTo path
    check_archive path, (err, bookobj, source_file)->
      if err
        return res.status(400).send(err)
      book_id = bookobj.id
      app.my.books.update {id: book_id}, bookobj, {upsert: true}, (err, doc)->
        if err
          console.log err
          return res.sendStatus 500
        upload_content app.my.db, book_id, source_file, (err)->
          console.log err
          if err
            console.log err
            return res.sendStatus 500
          res.location "/books/#{book_id}"
          res.sendStatus 201

app.route api_root + '/books/:book_id'
  .get (req, res)->
    book_id = parseInt req.params.book_id
    app.my.books.findOne {book_id: book_id}, {_id: 0}, (err, doc)->
      if err
        console.log err
        return res.status(404).end()
      else
        console.log doc
        res.json doc

content_type =
  'txt': 'text/plain; charset=shift_jis'

get_from_gs = (my, book_id, get_file, cb)->
  GridStore.read app.my.db, "#{book_id}.txt", (err, result)->
    if err
      if get_file
        get_file my, book_id, (err)->
          if err
            cb err
          else
            get_from_gs my, book_id, null, cb
      else
        cb err
    else
      cb null, zlib.inflateSync result

get_zipped = (my, book_id, cb)->
  my.books.findOne {book_id: book_id}, {text_url: 1}, (err, doc)->
    if err
      cb err
      return
    request.get doc.text_url,
      encoding: null
      headers:
        'User-Agent': 'Mozilla/5.0'
        'Accept': '*/*'
    , (err, res, body)->
      if err
        cb err
        return
      zip = new AdmZip body
      entry = zip.getEntries()[0] ## assuming zip has only one text entry
      data = zip.readFile entry
      zdata = zlib.deflateSync data
      upload_content_data my.db, book_id, zdata, (err)->
        cb err


app.route api_root + '/books/:book_id/content'
  .get (req, res)->
    book_id = parseInt req.params.book_id
    ext = req.query.format
    if ext == 'html'
      app.my.books.findOne {book_id: book_id}, {html_url: 1}, (err, doc)->
        if err
          console.log err
          return res.status(404).end()
        else
          res.redirect doc.html_url
    else if ext == 'txt'
      get_from_gs app.my, book_id, get_zipped, (err, result)->
        if err
          console.log err
          return res.status(404).end()
        else
          res.set 'Content-Type', content_type[ext] || 'application/octet-stream'
          res.send result

#
# drafts
#
app.route api_root + '/drafts'
  .post (req, res)->
    title = req.body.title
    author = req.body.author
    book_id = req.body.id
    is_private = req.body.private == true
    repo_backend.init_repo title, author, book_id, is_private, (status, data)->
      if data
        return res.status(status).json data
      else
        return res.sendStatus status

#
# persons
#
app.route api_root + '/persons'
  .get (req, res)->
    query = {}
    if req.query.name
      query.name = req.query.name
    app.my.persons.find query, {_id: 0}, (err, items)->
      items.toArray (err, docs)->
        if err
          console.log err
          return res.status(500).end()
        else
          res.json docs

app.route api_root + '/persons/:person_id'
  .get (req, res)->
    person_id = parseInt req.params.person_id
    app.my.persons.findOne {id: person_id}, {_id: 0}, (err, doc)->
      if err
        console.log err
        return res.status(404).end()
      else
        console.log doc
        res.json doc

#
# workers
#
app.route api_root + '/workers'
  .get (req, res)->
    query = {}
    if req.query.name
      query.name = req.query.name
    app.my.workers.find query, {_id: 0}, (err, items)->
      items.toArray (err, docs)->
        if err
          console.log err
          return res.status(500).end()
        else
          res.json docs

app.route api_root + '/workers/:worker_id'
  .get (req, res)->
    worker_id = parseInt req.params.worker_id
    app.my.workers.findOne {id: worker_id}, {_id: 0}, (err, doc)->
      if err
        console.log err
        return res.status(404).end()
      else
        console.log doc
        res.json doc


MongoClient.connect mongo_url, (err, db)->
  if err
    console.log err
    return -1
  port = process.env.PORT || 5000
  app.my = {}
  app.my.db = db
  app.my.books = db.collection('books')
  app.my.authors = db.collection('authors')
  app.my.persons = db.collection('persons')
  app.my.workers = db.collection('workers')
  app.listen port, ->
    console.log "Magic happens on port #{port}"
