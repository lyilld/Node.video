var express    = require('express');
var querystring = require('querystring');
var url = require('url');
var events = require('events');
var torrentStream = require('torrent-stream');
var ffmpeg = require('fluent-ffmpeg');
var promise = require('promise');
var Throttle = require('throttle');
var settings = require('./config.json');
var fs = require('fs');
var ffmpg = require('ffmpeg');

var app        = express();
var router = express.Router();
var handler = new events.EventEmitter();

var ffmpegKeyGen = 0;
var ffmpegHash = {};
var dataHash = {};
var startup_date = new Date;

var mimeTypes = {
	".flv":		"video/x-flv",
	".f4v":		"video/mp4",
	".f4p":		"video/mp4",
	".mp4":		"video/mp4",
	".mkv":		"video/matroska",
	".asf":		"video/x-ms-asf",
	".asr":		"video/x-ms-asf",
	".asx":		"video/x-ms-asf",
	".avi":		"video/x-msvideo",
	".mpa":		"video/mpeg",
	".mpe":		"video/mpeg",
	".mpeg":	"video/mpeg",
	".mpg":		"video/mpeg",
	".mpv2":	"video/mpeg",
	".mov":		"video/quicktime",
	".movie":	"video/x-sgi-movie",
	".mp2":		"video/mpeg",
	".qt":		"video/quicktime",
	".webm":	"video/webm",
	".ts":		"video/mp2t",
	".ogg":		"video/ogg"
};

var engineCount = 0;
var engineHash = {};
var enginePaths = {};

var magnet = "magnet:?xt=urn:btih:6f75e430fb2e382d1674de2770c7ed5292d39f75&dn=The.Secret.Life.of.Pets.2016.HDRip.XViD.AC3-ETRG&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Fzer0day.ch%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969";


var hasValidExtension = function(filename) {
	var extension = filename.match(/.*(\..+?)$/);
	if (extension !== null && extension.length === 2 && mimeTypes[extension[1].toLowerCase()] !== undefined) {
		return true;
	}
	return false;
}

var getMovieStream = function(magnet, torrent_path)
{
	return new Promise(function(fulfill, reject) {
  var original = true;
  var engine = torrentStream(magnet, { path: torrent_path });
  enginePaths[torrent_path] = enginePaths[torrent_path] ? enginePaths[torrent_path] : 1;
	engineHash[(engine.hashIndex = engineCount++)] = engine;
  engine.on('ready', function()
  {
    for (var i = 0; i < engine.hashIndex; i++)
    {
				if (engineHash[i] && engineHash[i].path === engine.path)
        {
					//console.log('spiderTorrent Notice: Engine', engine.hashIndex, 'not original: copying engine', i);
					engineHash[engine.hashIndex] = undefined;
					engine.destroy();
					engine = engineHash[i];
					original = false;
					break;
				}
			}
      var movie_file;
      engine.files.forEach(function(file)
      {
        if (hasValidExtension(file.name) && (!movie_file || file.length > movie_file.length))
        {
				//	console.log('Movie file found:', file.name, '| size:', file.length);
					if (movie_file)
          {
					//	console.log('Skipping item:', movie_file.name, '| size:', movie_file.length);
						movie_file.deselect();
					}
					movie_file = file;
				}
        else
        {
					//console.log('Skipping item:', file.name, '| size:', file.length);
					file.deselect();
				}
      });
      if (movie_file)
      {
				movie_file.select();
				var movie_data = {
					name: movie_file.name,
					length: movie_file.length,
					path: engine.path + '/' + movie_file.path
				};
				fulfill(movie_data);
        if(original)
        {
          movie_file.createReadStream({ start: movie_file.length - 1025, end: movie_file.length - 1 });
          engine.on('download', function(piece_index) {
             if (piece_index % 10 == 0) {
              console.log('torrentStream Notice: Engine', engine.hashIndex, 'downloaded piece: Index:', piece_index, '(', engine.swarm.downloaded, '/', movie_file.length, ')');
              }
            });
        }
				return fulfill(true);
      }
      else {
            engine.removeAllListeners();
            engine.destroy();
            return reject({
              message: 'No valid movie file was found'
            });
          }
  });
});
}

var spiderTorrent = function(req, res) {
	// console.log('spiderTorrent Notice: Request:', req);
	//console.log('spiderTorrent Notice: Query:', req.query);
	//console.log('spiderTorrent Notice: Headers:', req.headers);
	var range = req.headers.range;
	var movie_id;
	//if (movie_id && resolution && resolution.resolution == undefined) {
			var torrent_path = './torrent';
			/* DONE BY TORRET-STREAM: Create folder './torrents/'+movie._id+'/'+resolution.resolution in a way that does not destroy it if it exists */
			//console.log('spiderTorrent Notice: Movie not yet torrented; torrenting:', );
			getMovieStream(magnet, torrent_path).then(
				/* Promise fulfill callback */
				function(data) {
					console.log("BIIIIIIIITTTTEEEEEEEEEE:", data);
					spiderStreamer(data, req.query, range, res);
				},
				/* Promise reject callback */
				function(err) {
					console.log('spiderTorrent Error:'.red, err.message);
					handler.emit("noMovie", res);
					return false;
				});
	return true;
}

var downloadHeader = function(res, info)
{
	var code = 200;
	var header;
	console.log("START SET HEADER");
	// console.log(info);
	// 'Connection':'close',
	// 'Cache-Control':'private',
	// 'Transfer-Encoding':'chunked'

	if (settings.forceDownload)
	{
		//console.log("kakakakakakakakaka");
		header =
		{
			Expires: 0,
			"Cache-Control": "must-revalidate, post-check=0, pre-check=0",
			//"Cache-Control": "private",
			"Content-Type": info.mime,
			"Content-Disposition": "attachment; filename=" + info.file + ";"
		};
	}
	else
	{
		console.log("BBBBBBBBBBBBBBBB");
		header =
		{
			"Cache-Control": "public; max-age=" + settings.maxAge,
			Connection: "keep-alive",
			"Content-Type": info.mime,
			"Content-Disposition": "inline; filename=" + info.file + ";",
			"Accept-Ranges": "bytes"
		};
		if (info.rangeRequest)
		{
			// Partial http response
			code = 206;
			header.Status = "206 Partial Content";
			header["Content-Range"] = "bytes " + info.start + "-" + info.end + "/" + info.size;
		}
		console.log("CCCCCCCCCCCCCCC");
		res.writeHead(code, header);
	}
	console.log("DDDDDDDDDDDDD");

	header.Pragma = "public";
	header["Last-Modified"] = info.modified.toUTCString();
	header["Content-Transfer-Encoding"] = "binary";
	header["Content-Length"] = info.length;
    if(settings.cors)
		{
        header["Access-Control-Allow-Origin"] = "*";
        header["Access-Control-Allow-Headers"] = "Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept";
    }
		header.Server = settings.server;
    header.Server = settings.server;
	console.log("HEADER SET, can stream now");
	res.writeHead(code, header);
};


var spiderStreamer = function(data, query, range_string, res) {
	var stream;
	var info = {};
	var range;
	var i;
	var timer_id;

	ext = data.name.match(/.*(\..+?)$/);

	if (ext === null || ext.length !== 2 || (info.mime = mimeTypes[ext[1].toLowerCase()]) === undefined) {
		console.error('spiderStreamer Error:'.red, 'Invalid mime type:', data.name);
		handler.emit("badMime", res);
		return false;
	}

	console.error('spiderStreamer Notice: Mime type', info.mime, 'found for file:', data.name);

	info.file = data.name;
	info.path = data.path;
	info.size = data.length;
	info.modified = data.date;

	new Promise(function(fulfill, reject) {
		/* ONLY DO THE FOLLOWING IF NOT MP4 */
		if (info.mime !== "video/mp4") {
			console.log('spiderStreamer Notice: Needs to be converted to video/mp4:', info.path);
			var old_path = info.path;
			var converted_path = info.path+'.converted.mp4';
			var converted_file = info.file+'.converted.mp4';
			var key = ++ffmpegKeyGen;
			console.log("$$$$$$$ INFOS $$$$$$");
			console.log(converted_path);
			console.log(converted_file);
			console.log(key);
			console.log("$$$$$$$$$$$$$");
			if (ffmpegHash[old_path] === undefined) {
				console.log('fluent-ffmpeg Notice:', key+':', 'Movie not yet converted, competing for key...');
				ffmpegHash[old_path] = key;
			}
			if (ffmpegHash[old_path] === key) {
				console.log('fluent-ffmpeg Notice:', key+':', 'Chosen for conversion');
				console.log('spiderStreamer Notice: Converting to video/mp4');
				var fails = 0;
				var busy = false;
				var interval_id = setInterval(function() {
					if (!busy) {
						busy = true;
						try {
							console.log("TRYING");
							console.log(old_path);
							ffmpeg().input(old_path)
								.on("error", function(err, stdout, stderr) {
									console.error('spiderStreamer Error:'.red, 'Could not convert file:', old_path);
									console.log('fluent-ffmpeg Error:'.red, '\nErr:', err, '\nStdOut:', stdout, '\nStdErr:', stderr);
									/* Handle error */
									++fails;
									busy = false;
									 //console.log('spiderStreamer Notice: Giving up: Piping raw stream');
									 //stream.pipe(res);
									 console.log("FATAL ERROR");
								})
								.on('start', function(cmd) {
									console.log('fluent-ffmpeg Notice: Started:', cmd);
								})
								.on('codecData', function(data) {
									console.log('fluent-ffmpeg Notice: CodecData:', data);
									clearInterval(interval_id);
									fulfill(data);
									dataHash[old_path] = data;
								})
								 .on('progress', function(progress) {
								 	console.log('fluent-ffmpeg Notice: Progress:', progress.timemark, 'converted');
								 })
								// .inputFormat(format)
								.audioCodec('aac')
								.videoCodec('libx264')
								.output(converted_path)
								.outputFormat('mp4')
								.outputOptions('-movflags frag_keyframe+empty_moov')
								.run();
								// .pipe(res);

						} catch(exception) {
							console.log("CATCHING");
							//console.error('spiderStreamer Error:'.red, 'Could not convert file:', old_path);
							//console.error('fluent-ffmpeg Error:'.red, exception);
							/* Handle error */
							++fails;
							busy = false;
							// console.log('spiderStreamer Notice: Giving up: Piping raw stream');
							// stream.pipe(res);
						}
					} else {
						console.log('fluent-ffmpeg is busy');
					}
					if (fails > 30 && busy === false) {
						clearInterval(interval_id);
						reject('fluent-ffmpeg never launched without error');
					}
				}, 3000);
			} else {
				console.log('fluent-ffmpeg Notice:', key+':', 'Movie already converted');
				fulfill(dataHash[old_path]);
			}

			info.file = converted_file;
			info.path = converted_path;
			info.mime = 'video/mp4';
			// info.modified = startup_date;
			info.modified = new Date;
			try {
				info.size = fs.statSync(info.path).size;
			} catch(exception) {
				console.log('spiderStreamer Error:', 'Converted movie size not found');
				info.size = 0;
			}
		} else {
			console.log('spiderStreamer Notice: No conversion needed:', info.mime);
			fulfill(false);
		}
		/* ONLY DO THE ABOVE IF NOT MP4 */

	}).then(
		function(success) {
			new Promise(function(fulfill, reject) {
				var fails = 0;
				var interval_id = setInterval(function() {
					try {
						info.size = fs.statSync(info.path).size;
						console.log('spiderStreamer Notice:', info.path, ' size:', info.size);
						if (info.size > 5000000) {
							clearInterval(interval_id);
							fulfill(info.size);
							return;
						}
						console.log('spiderStreamer Notice: Movie file not yet big enough; fails:', fails);
					} catch(exception) {
						console.error('spiderStreamer Error:'.red, exception);
					}
					++fails;
					if (fails > 30) {
						clearInterval(interval_id);
						reject('Movie file never grew to at least 5mb');
					}
				}, 2000);
			}).then(
				function(success) {
					//console.log("//////  SUCESS  ///////");
					info.rangeRequest = false;
					info.start = 0;
					info.end = info.size - 1;
					if (range_string && (range = range_string.match(/bytes=(.+)-(.+)?/)) !== null) {
						info.start = isNumber(range[1]) && range[1] >= 0 && range[1] < info.end ? range[1] - 0 : info.start;
						info.end = isNumber(range[2]) && range[2] > info.start && range[2] <= info.end ? range[2] - 0 : info.end;
						info.rangeRequest = true;
					} else if (query.start || query.end) {
						// This is a range request, but doesn't get range headers. So there.
						info.start = isNumber(query.start) && query.start >= 0 && query.start < info.end ? query.start - 0 : info.start;
						info.end = isNumber(query.end) && query.end > info.start && query.end <= info.end ? query.end - 0 : info.end;
					}

					info.length = info.end - info.start + 1;

					console.log('spiderStreamer Notice: Header Info:', info);

					console.log('spiderStreamer Notice: Sending header');
					downloadHeader(res, info);
					console.log("///  before trying  ///");
					// // Flash vids seem to need this on the front, even if they start part way through. (JW Player does anyway.)
					// if (info.start > 0 && info.mime === "video/x-flv") {
					// 	res.write("FLV" + pack("CCNN", 1, 5, 9, 9));
					// }
					try {
						console.log("################ create a readable file here");
						stream = fs.createReadStream(info.path, { flags: "r", start: info.start, end: info.end });
						if (settings.throttle) {
							stream = stream.pipe(new Throttle(settings.throttle));
						}
						console.log('spiderStreamer Notice: Piping stream...');
						stream.pipe(res);
						console.log('spiderStreamer Notice: Pipe set');
					} catch(exception) {
						//console.log("? Something WRONG ?")
						stream = null;
						i = 0;
						console.log('spiderStreamer Error:'.red, exception);
						console.log('spiderStreamer Notice: Retrying... i:', i);
						timer_id = setInterval(function() {
							++i;
							if (stream === null) {
								if (i === 5) {
									clearInterval(timer_id);
									console.error('spiderStreamer Error:'.red, 'Could not stream file:', info.path);
									/* Can't set headers after they are sent. */
									// handler.emit("badFile", res);
									return;
								}

								try {
									console.log("############## Made up stream");
									stream = fs.createReadStream(info.path, { flags: "r", start: info.start, end: info.end });
								} catch(exception) {
									console.log('spiderStreamer Error:'.red, exception);
									console.log('spiderStreamer Notice: Retrying in 3 seconds... i:', i);
									stream = null
								}
								if (stream !== null) {
									clearInterval(timer_id);
									if (settings.throttle) {
										stream = stream.pipe(new Throttle(settings.throttle));
									}
									console.log('spiderStreamer Notice: Piping stream...');
									stream.pipe(res);
									console.log('spiderStreamer Notice: Pipe set');
								}
							} else if (stream !== null) {
								clearInterval(timer_id);
							}
						}, 3000);
					}
				},
				function(failure) {
					console.log('spiderStreamer Error:'.red, failure);
				}
			);
		},
		function(failure) {
			console.log('spiderStreamer Error:'.red, failure);
		}
	);
};

spiderStreamer.settings = function(s) {
	for (var prop in s) { settings[prop] = s[prop]; }
	return spiderStreamer;
};

var errorHeader = function(res, code) {
	var header = {
		"Content-Type": "text/html",
		Server: settings.server
	};

	res.writeHead(code, header);
};

var isNumber = function (n) {
	return !isNaN(parseFloat(n)) && isFinite(n);
};

var pack = function(format) {
	var result = "";

	for (var pos = 1, len = arguments.length; pos < len; pos++) {
		if (format[pos - 1] == "N") {
			result += String.fromCharCode(arguments[pos] >> 24 & 0xFF);
			result += String.fromCharCode(arguments[pos] >> 16 & 0xFF);
			result += String.fromCharCode(arguments[pos] >> 8 & 0xFF);
			result += String.fromCharCode(arguments[pos] & 0xFF);
		} else {
			result += String.fromCharCode(arguments[pos]);
		}
	}
	return result;
};

router.use(function(req, res, next) {
    var params = querystring.parse(url.parse(req.url).query);
  	spiderTorrent(req, res);
    next();
});

router.get('/', function(req, res) {
     res.json({ message: 'hooray! welcome to our api!' });
 });

router.get('/torrent', spiderTorrent);


app.listen(3000);
