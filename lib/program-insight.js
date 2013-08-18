
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const DEEPCOPY = require("deepcopy");
const CRYPTO = require("crypto");
const FS = require("fs");
const PACKAGE_INSIGHT = require("pinf-it-package-insight");


// Descriptors get merged on top of each other in reverse order.
exports.LOOKUP_PATHS = [
	//   1) /program.$PINF_MODE.json (~ $PINF_PROGRAM)
	function (ENV) {
		return ENV.PINF_PROGRAM.replace(".json", "." + ENV.PINF_MODE + ".json");
	},
	//   2) /.rt/program.rt.json ($PINF_RUNTIME)
	//		The `rt` descriptor holds the runtime information for this instance of the program. There can always
	//		only be one runtime instance of a program installation. If you want to boot a second, create an
	//		inheriting program descriptor in a new directory and boot it there.
	function (ENV) {
		return ENV.PINF_RUNTIME;
	},
	//   3) /.program.json (~ $PINF_PROGRAM)
	function (ENV) {
		return ENV.PINF_PROGRAM.replace(/\/\.?([^\/]*)$/, "\/.$1");
	},
	//   5) /program.json ($PINF_PROGRAM)
	function (ENV) {
		return ENV.PINF_PROGRAM;
	},
	//   7) <parent>/program.json ($PINF_PROGRAM_PARENT)
	function (ENV) {
		return ENV.PINF_PROGRAM_PARENT;
	}
];


exports.parse = function(programPath, options, callback) {

	options = options || {};

	if (options.debug) console.log("[pinf-it-program-insight] programPath", programPath);

	// TODO: We should not need to copy `env`. It should not be modified in code below.
	if (options.env) {
		options.env = DEEPCOPY(options.env);
	}

	options._realpath = function(path) {
		if (!options.rootPath) return path;
		if (/^\//.test(path)) return path;
		return PATH.join(options.rootPath, path);
	}

	var opts = {};
	for (var name in options) {
		opts[name] = options[name];
	}
	// TODO: Get list of files to search from `pinf-for-nodejs/lib/context.LOOKUP_PATHS`. Exclude the 'package' paths.
	opts.lookupPaths = exports.LOOKUP_PATHS;

	var visitedDependencies = {};

	return PACKAGE_INSIGHT.parse(programPath, opts, function(err, programDescriptor) {
		if (err) return callback(err);

		function followDependencies(descriptor, callback) {
			if (
				!descriptor.combined.dependencies ||
				!descriptor.combined.dependencies.bundled
			) {
				return callback(null);
			}
			var waitfor = WAITFOR.serial(callback);
			for (var alias in descriptor.combined.dependencies.bundled) {
				waitfor(alias, function(alias, done) {
					return followPackage(PATH.join(descriptor.dirpath, descriptor.combined.dependencies.bundled[alias]), done);
				});
			}
			return waitfor();
		}

		function followPackage(uri, callback) {
			if (
				programDescriptor.combined.packages &&
				programDescriptor.combined.packages[uri]
			) {
				return callback(null);
			}
			return FS.realpath(options._realpath(uri), function(err, realUri) {
				if (err) return callback(err);
				if (visitedDependencies[realUri]) {
					return callback(null);
				}
				return FS.exists(options._realpath(uri), function(exists) {
					if (!exists) return callback(null);
					var opts = {};
					for (var name in options) {
						opts[name] = options[name];
					}
					if (opts.env) {
						opts.env.PINF_PACKAGE = "";
					}
					return PACKAGE_INSIGHT.parse(uri, opts, function(err, descriptor) {
						if (err) return callback(err);

						if (!programDescriptor.combined.packages) {
							programDescriptor.combined.packages = {};
						}
						programDescriptor.combined.packages[uri] = descriptor;
						visitedDependencies[realUri] = true;

						if (!options.includePackages) return callback(null); 

						return followDependencies(descriptor, callback);
					});
				});
			});
		}

		// Now that we have the program descriptor we parse the boot package
		// and include all linked package descriptors in our program descriptor.
		if (
			!programDescriptor.combined.boot ||
			!programDescriptor.combined.boot.package
		) {
			return callback(null, programDescriptor);
		}
		return followPackage(programDescriptor.combined.boot.package, function(err) {
			if (err) return callback(err);

			return callback(null, programDescriptor);
		});
	});
}


exports.parseDescriptor = PACKAGE_INSIGHT.parseDescriptor;
