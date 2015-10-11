var gulp = require('gulp');
var through = require('through2');
var gutil = require('gulp-util');
var merge = require('merge-stream');
var del = require('del');
var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var win32 = process.platform === "win32";
var spawn = require('child_process').spawn;
var glob = require('glob');
var gulpPath = path.join(__dirname, 'node_modules/.bin/gulp' + (win32 && '.cmd' || ''));
var metadata = {
    lib: ['lib/**/*.ts', '!lib/**/*.d.ts'],
    spec: ['spec/**/*.ts'],
};

gulp.task('typescript', ['sync-clients','clean'], function() {
    var args = ['--declaration', '-p', path.resolve(__dirname.toString())];
    var compile = new Promise(function(resolve, reject) {
        var tsc = spawn(path.resolve(__dirname + '/node_modules/.bin/ntsc' + (win32 && '.cmd' || '')), args);
        tsc.stdout.pipe(process.stdout);
        tsc.stderr.pipe(process.stderr);
        tsc.on('close', function(code) {
            resolve();
        });
    });

    return compile;
});

gulp.task('omnisharp-client-declaration', ['typescript'], function() {
    return new Promise(function(resolve) {
        glob('lib/**/*.d.ts', {}, function(e, files) {
            files = _.filter(files, function(x) { return !(_.endsWith(x, 'es6.d.ts') || _.contains(x, 'drivers/')) });
            var output = ['/// <reference path="./omnisharp-server.d.ts" />'];
            var temp = _.template('declare module "${name}" {\n${content}\n}\n');
            _.each(files, function(file) {
                var name = 'omnisharp-client/' + file.substring(0, file.length - 5).replace(/lib\//g, '');
                var dot = name.split('/');
                dot = dot.slice(0, dot.length - 1).join('/');
                var dotdot = name.split('/');
                dotdot = dotdot.slice(0, dotdot.length - 2).join('/');
                var content = fs.readFileSync(file).toString();
                content = content.replace(/\.\.\//g, '' + dotdot + '/');
                content = content.replace(/\.\//g, '' + dot + '/');
                content = content.replace(/export declare/g, 'export');
                content = content.replace(/declare module/g, 'export module');

                output.push(temp({name: name, content: content }));
            });

                output = output.join('\n\n').replace('declare module "omnisharp-client/omnisharp-client"', 'declare module "omnisharp-client"');

            fs.writeFileSync('omnisharp-client.d.ts', output);

            resolve();
        });
    });
});

gulp.task('clean', ['clean:lib', 'clean:spec']);

gulp.task('clean:lib', function(done) {
    del(metadata.lib.map(function(z) { return gutil.replaceExtension(z, '.js'); }), function(err, paths) {
        _.each(paths, function(path) {
            gutil.log(gutil.colors.red('Deleted ') + gutil.colors.magenta(path.replace(__dirname, '').substring(1)));
        });
        done();
    });
});

gulp.task('clean:spec', function(done) {
    del(metadata.spec.map(function(z) { return gutil.replaceExtension(z, '.js'); }), function(err, paths) {
        _.each(paths, function(path) {
            gutil.log(gutil.colors.red('Deleted ') + gutil.colors.magenta(path.replace(__dirname, '').substring(1)));
        });
        done();
    });
});

gulp.task('sync-clients', [], function() {
    var omnisharpServer = fs.readFileSync('./omnisharp-server.d.ts').toString();
    _.each(['v1', 'v2'], function(version) {
        var VERSION = version.toUpperCase();
        var regex = new RegExp('declare module OmniSharp\\.Events {[\\s\\S]*?interface '+VERSION+' {([\\s\\S]*?)}');

        var interf = omnisharpServer.match(regex)[1];
        var properties = [];
        _.each(_.trim(interf).split('\n'), function(line) {
            line = _.trim(line);
            if (_.startsWith(line, '//')) return;

            var name = line.indexOf(':');
            if (line && name > -1) {
                properties.push({
                    line: _.trimRight(line.substr(name), ';').replace('CombinationKey<', 'OmniSharp.CombinationKey<').replace('Context<', 'OmniSharp.Context<'),
                    name: line.substr(0, name)
                });
            }
        });

        var regex2 = new RegExp('declare module OmniSharp\\.Events\\.Aggregate {[\\s\\S]*?interface '+VERSION+' {([\\s\\S]*?)}');
        var interf2 = omnisharpServer.match(regex2)[1];
        var aggregateProperties = [];
        _.each(_.trim(interf2).split('\n'), function(line) {
            line = _.trim(line);
            if (_.startsWith(line, '//')) return;

            var name = line.indexOf(':');
            if (line && name > -1) {
                aggregateProperties.push({
                    line: _.trimRight(line.substr(name), ';').replace('CombinationKey<', 'OmniSharp.CombinationKey<').replace('Context<', 'OmniSharp.Context<'),
                    name: line.substr(0, name)
                });
            }
        });

        var result = _.template('\
// THIS FILE IS GENERATED BY GULP TASK: "sync-clients"\n\
import {ClientEvents${VERSION}} from "../clients/client-${version}";\n\
import {ObservationClientBase, CombinationClientBase} from "./composite-client-base";\n\
import {merge, aggregate} from "../decorators";\n\
type CombinationKey<T> = OmniSharp.CombinationKey<T>;\n\
type Context<TRequest, TResponse> = OmniSharp.Context<TRequest, TResponse>;\n\
\n\
export class ObservationClient${VERSION}<T extends ClientEvents${VERSION}> extends ObservationClientBase<T> implements OmniSharp.Events.${VERSION} {\
<% _.each(properties, function(property){ %>\n    @merge public get ${property.name}()${property.line} { throw new Error("Implemented by decorator"); }<% }); %>\n\
}\n\
\n\
export class AggregateClient${VERSION}<T extends ClientEvents${VERSION}> extends CombinationClientBase<T> implements OmniSharp.Events.Aggregate.${VERSION} {\
<% _.each(aggregateProperties, function(property){ %>\n    @aggregate public get ${property.name}()${property.line} { throw new Error("Implemented by decorator"); }<% }); %>\n\
}\n')({ properties: properties, aggregateProperties: aggregateProperties, VERSION: VERSION, version: version });

        fs.writeFileSync('./lib/aggregate/composite-client-'+version+'.ts', result);
    });

    _.each(['v1', 'v2'], function(version) {
        var VERSION = version.toUpperCase();
        var regex = new RegExp('declare module OmniSharp\\.Events {[\\s\\S]*?interface '+VERSION+' {([\\s\\S]*?)}');

        var interf = omnisharpServer.match(regex)[1];
        var events = [];
        _.each(_.trim(interf).split('\n'), function(line) {
            line = _.trim(line);
            if (_.startsWith(line, '//')) return;

            var name = line.indexOf(':');
            if (line && name > -1) {
                events.push({
                    line: _.trimRight(line.substr(name), ';'),
                    name: line.substr(0, name)
                });
            }
        });

        var regex2 = new RegExp('declare module OmniSharp\\.Events {[\\s\\S]*?interface '+VERSION+' {([\\s\\S]*?)}');
        var interf2 = omnisharpServer.match(regex2)[1];
        var properties = [];
        _.each(_.trim(interf2).split('\n'), function(line) {
            line = _.trim(line);
            if (_.startsWith(line, '//')) return;

            var name = line.indexOf(':');
            if (line && name > -1) {
                properties.push({
                    line: _.trimRight(line.substr(name), ';'),
                    name: line.substr(0, name)
                });
            }
        });

        var result = _.template('\
// THIS FILE IS GENERATED BY GULP TASK: "sync-clients"\n\
import * as _ from "lodash";\n\
import {OmnisharpClientOptions} from "../interfaces.d";\n\
import {ProxyClientBase} from "./proxy-client-base";\n\
import {Client${VERSION}, ClientEvents${VERSION}} from "../clients/client-${version}";\n\
import {proxyProperties} from "./decorators";\n\
import {ClientProxyWrapper} from "./client-proxy-wrapper";\n\
\n\
export class ProxyClient${VERSION} extends ProxyClientBase<ClientEvents${VERSION}> implements OmniSharp.Api.${VERSION} {\n\
    constructor(_options: OmnisharpClientOptions, _proxy: ClientProxyWrapper) {\n\
        super(_options, c => new ClientEvents${VERSION}(c), _proxy);\n\
    }\
<% _.each(properties, function(property){ %>\n    public ${property.name}: typeof  Client${VERSION}.prototype.${property.name};<% }); %>\n\
}\n\
proxyProperties(ProxyClientBase, ProxyClient${VERSION});\n\
\n')({ properties: properties, events: events, VERSION: VERSION, version: version });

        fs.writeFileSync('./lib/proxy/proxy-client-'+version+'.ts', result);
    });

});

gulp.task('watch', function() {
    // Watch is not installed by default if you want to use it
    //  you need to install manually but don't save it as it causes CI issues.
    var watch = require('gulp-watch');
    // Auto restart watch when gulpfile is changed.
    var p = spawn(gulpPath, ['file-watch'], {stdio: 'inherit'});
    return watch('gulpfile.js', function() {
        p.kill();
        p = spawn(gulpPath, ['file-watch'], {stdio: 'inherit'});
    });
});

gulp.task('file-watch', function() {
    // Watch is not installed by default if you want to use it
    //  you need to install manually but don't save it as it causes CI issues.
    var watch = require('gulp-watch');
    var plumber = require('gulp-plumber');
    var newer = require('gulp-newer');

    var lib = tsTranspiler(gulp.src(metadata.lib)
        .pipe(watch(metadata.lib))
        .pipe(plumber())
        .pipe(newer('./lib')), './lib')

    var spec = tsTranspiler(gulp.src(metadata.spec)
        .pipe(watch(metadata.spec))
        .pipe(plumber())
        .pipe(newer('./spec')), './spec');

    return merge(lib, spec);
});

gulp.task('npm-prepublish', ['typescript', 'omnisharp-client-declaration']);

// The default task (called when you run `gulp` from CLI)
gulp.task('default', ['typescript', 'omnisharp-client-declaration']);
