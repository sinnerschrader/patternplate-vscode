import * as vscode from 'vscode';

export class Logger {

	constructor(private channel: vscode.OutputChannel) {
	}

	log(method, ...args) {
		this.channel.appendLine(`${method} ${args.join(' ')}`);
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
