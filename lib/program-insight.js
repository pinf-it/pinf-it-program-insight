
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const CRYPTO = require("crypto");
const FS = require("fs");
const PACKAGE_INSIGHT = require("pinf-it-package-insight");


exports.parse = function(programPath, options, callback) {

	options = options || {};

	var opts = {};
	for (var name in options) {
		opts[name] = options[name];
	}
	// TODO: Get list of files to search from `pinf-for-nodejs/lib/context.LOOKUP_PATHS`. Exclude the 'package' paths.
	opts.lookupPaths = [
	    "program.json"
	];

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
			return PACKAGE_INSIGHT.parse(uri, options, function(err, descriptor) {
				if (!programDescriptor.combined.packages) {
					programDescriptor.combined.packages = {};
				}
				programDescriptor.combined.packages[uri] = descriptor;
				return followDependencies(descriptor, callback);
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
