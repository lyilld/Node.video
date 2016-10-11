 var fs = require('fs');
 var events = require('events');
 var colors  = require('colors');
 var promise = require('promise');
 var torrentStream = require('torrent-stream');
 var querystring = require('querystring');
 var url = require('url');
 var mimeTypes = require('./mime_types');
 var settings = require('./config.json');

 var handler = new events.EventEmitter();
 var spiderStreamer = require('./streamer');

var hasValidExtension = function(filename) {
	var extension = filename.match(/.*(\..+?)$/);
	if (extension !== null && extension.length === 2 && mimeTypes[extension[1].toLowerCase()] !== undefined) {
		return true;
	}
	return false;
}

var engineCount = 0;
var engineHash = {};
var enginePaths = {};

var getMovieStream = function(magnet, torrent_path) {
	return new Promise(function(fulfill, reject) {
		var original = true;
		var engine = torrentStream(magnet, {
			path: torrent_path
		});
		enginePaths[torrent_path] = enginePaths[torrent_path] ? enginePaths[torrent_path] : 1;
		engineHash[(engine.hashIndex = engineCount++)] = engine;
 	  console.log('Waiting for torrentStream engine'.yellow);
		engine.on('ready', function() {
			for (var i = 0; i < engine.hashIndex; i++) {
				if (engineHash[i] && engineHash[i].path === engine.path) {
          console.log("nombre d'instance = ".red, engineCount, "Index actuel = ".green, engine.hashIndex);
					engineHash[engine.hashIndex] = undefined;
					engine.destroy();
					engine = engineHash[i];
				//	original = false;
					break;
				}
			}

 			/* Actual Engine Manipulation */
			var movie_file;
			engine.files.forEach(function(file) {
				if (hasValidExtension(file.name) && (!movie_file || file.length > movie_file.length)) {
					console.log('GMS : Movie file found:'.green, file.name, '| size:', file.length);
					if (movie_file) {
						console.log('GMS : Skipping movie_file:'.magenta, movie_file.name, '| size:', movie_file.length);
						movie_file.deselect();
					}
					movie_file = file;
				} else {
					console.log('GMS : Skipping file:'.magenta, file.name, '| size:', file.length);
					file.deselect();
				}
			});
 			if (movie_file) {
 				movie_file.select();
				var movie_data = {
					name: movie_file.name,
					length: movie_file.length,
					date: Date.now(),
					path: engine.path + '/' + movie_file.path
				};
 				console.log('GMS : Movie Data :'.green, movie_data);
 				fulfill(movie_data);
 				if (original) {
 					movie_file.createReadStream({ start: movie_file.length - 1025, end: movie_file.length - 1 });
          console.log("GMS : Lunch movie downloading".cyan);
 					engine.on('download', function(piece_index) {
 						 if (piece_index % 5 == 0) {
 						console.log('GMS : Donwloading'.yellow.italic, engine.hashIndex, 'Current piece'.yellow, piece_index, '(', engine.swarm.downloaded, '/', movie_file.length, ')');
 						 }
 					});
					engine.on('idle', function() {
						console.log('GMS : ! Torrent DONWNLOADED !'.green, engine.hashIndex, 'idle'.green);
							engine.removeAllListeners();
							engine.destroy();
            });
					}
       else {
    				engine.removeAllListeners();
    				engine.destroy();
    				return reject({
    					message: 'No valid movie file was found'
    				});
   			}
   		}
   	});
  });
  console.log('GMS : Torrent Stream Error:'.red, err.message);
}

   /* Called by page /torrent */
 var spiderTorrent = function(req, res) {
    var params = querystring.parse(url.parse(req.url).query);
    console.log("[/torrent] Get spiderTorrent function at this address".cyan);
    var movie_id = 1;
    var range = req.headers.range;
    var torrent_path = './torrents/'+params['id'];
    var file_size;
    var magnet = params['magnet'];
    // Could check if movie exist ?
    getMovieStream(magnet, torrent_path).then(
    	function(data) {
    		console.log('spiderTorrent : Callback receive from getMovieStream with this data'.grey, data);
    		spiderStreamer(data, req.query, range, res);
    	},
    	function(err) {
    		console.log('spiderTorrent: getMovieStream ERROR'.red);
    		handler.emit("noMovie", res);
    		return false;
    	}
    );
	return true;
}

var errorHeader = function(res, code) {
	var header = {
		"Content-Type": "text/html",
		Server: settings.server
	};
	res.writeHead(code, header);
};

handler.on("noMovie", function(res) {
	errorHeader(res, 404);
	res.end("<!DOCTYPE html><html lang=\"en\">" +
		"<head><title>404 Not found</title></head>" +
		"<body>" +
		"<h1>Sorry...</h1>" +
		"<p>I can't play that movie.</p>" +
		"</body></html>");
});

 module.exports = spiderTorrent;
