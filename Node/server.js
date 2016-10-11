var express = require('express');
var path = require('path');
var http = require('http');
var spiderTorrent = require("./torrent");
var colors  = require('colors');
var torrentStream = require('torrent-stream');
var mimeTypes = require('./mime_types');

var app = express.Router();
var server = http.createServer(app);

app.get('/torrent/:id', spiderTorrent);

server.listen(8888);
console.log("Server launch on port 8888".cyan);
