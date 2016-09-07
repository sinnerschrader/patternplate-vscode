import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from './logger';
import { HttpRenderer } from './http-renderer';

export interface PatternplateAdapter {
	uri: vscode.Uri;
	start(): Promise<void>;
	stop(): Promise<void>;
	isStarted(): boolean;
	renderDemo(patternId: string): Promise<string>;
}

export function createAdapter(logger: Logger): PatternplateAdapter {
	return new Patternplate0x(logger);
}

class Patternplate0x implements PatternplateAdapter {

	private logger: Logger;

	private app: any;

	private base: string = '';

	private renderer: HttpRenderer;

	private firstRender = true;

	constructor(logger: Logger) {
		this.logger = logger;
		this.renderer = new HttpRenderer();
	}

	public start(): Promise<void> {
		return Promise.resolve()
			.then(() => {
				console.log(`Starting patternplate in ${vscode.workspace.rootPath}`);
				process.chdir(vscode.workspace.rootPath);
				const patternplatePath = path.join(vscode.workspace.rootPath, 'node_modules', 'patternplate') || 'patternplate';
				const patternplate = require(patternplatePath);
				patternplate({
					mode: 'server'
				}).then(app => {
					this.app = app;

					// set and freeze logger
					app.log.deploy(this.logger);
					app.log.deploy = function() {}

					return app.start()
						.then(() => app);
				}).then(app => {
					const { host, port } = app.configuration.server;
					this.base = `http://${host}:${port}`;
					console.log(`Started patternplate on '${this.base}'`)
				}).catch(error => {
					console.error(error);
					vscode.window.showErrorMessage(error.message);
				});
			});
	}

	public stop() {
		return Promise.resolve();
	}

	get uri(): vscode.Uri {
		return vscode.Uri.parse(this.base);
	}

	public isStarted(): boolean {
		return Boolean(this.base);
	}

	public renderDemo(patternId: string): Promise<string> {
		let retries = 0;
		const tryRender = () => {
			return this.renderer
				.render(this.base, patternId)
				.then(html => {
					this.firstRender = false;
					return html;
				})
				.catch(error => {
					if (this.firstRender && retries < 10) {
						retries++;
						return new Promise(resolve => {
							setTimeout(() => {
								resolve(tryRender());
							}, 1000);
						});
					}
					throw error;
				});
		};
		return tryRender();
	}

}
