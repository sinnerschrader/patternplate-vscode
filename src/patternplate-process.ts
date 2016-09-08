import 'core-js/fn/object/entries';
import 'regenerator-runtime/runtime';

import * as RPC from './rpc';
import * as path from 'path';

console.log = function(...args) {
	process.send({
		type: 'log',
		args
	} as RPC.Log);
}

let cwd: string;

process.on('message', (message: RPC.Message) => {
	switch (message.type) {
		case 'start':
			cwd = (message as RPC.Start).cwd;
			console.log(`Starting patternplate in ${cwd}`);
			process.chdir(cwd);
			const patternplatePath = path.join(cwd, 'node_modules', 'patternplate') || 'patternplate';
			const patternplate = require(patternplatePath);
			patternplate({
				mode: 'server'
			}).then(app => {
				// set and freeze logger
				app.log.deploy(new Logger());
				app.log.deploy = function() {}

				return app.start()
					.then(() => app);
			}).then(app => {
				const port = app.configuration.server.port;
				console.log(`Started patternplate on port '${port}'`)
				process.send({
					type: 'started',
					port
				} as RPC.Started);
			}).catch(error => {
				console.log(error);
				process.send({
					type: 'error',
					error: error.message
				} as RPC.Error)
			});
			break;
	}
});

class Logger {

	log(method, ...args) {
		console.log(`${method} ${args.join(' ')}`);
	}

	error(...args) {
		this.log('error', ...args);
	}

	warn(...args) {
		this.log('warn', ...args);
	}

	info(...args) {
		this.log('info', ...args);
	}

	debug(...args) {
		this.log('debug', ...args);
	}

	silly(...args) {
		this.log('silly', ...args);
	}

}
