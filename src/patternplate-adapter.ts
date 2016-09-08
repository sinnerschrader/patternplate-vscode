import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import * as http from 'http';
import * as url from 'url';
import * as vscode from 'vscode';
import { Logger } from './logger';
import * as RPC from './rpc';

export interface PatternplateAdapter {
	uri: vscode.Uri;
	start(): Promise<void>;
	stop(): Promise<void>;
	isStarted(): boolean;
	renderDemo(patternId: string): Promise<string>;
	getPatternIds(): Promise<string[]>;
}

export function createAdapter(logger: Logger): PatternplateAdapter {
	return new Patternplate0x(logger);
}

class Patternplate0x implements PatternplateAdapter {

	private logger: Logger;

	private base: string = '';

	private connector: HttpConnector;

	private firstRender = true;

	private patternplateProcess: ChildProcess;

	constructor(logger: Logger) {
		this.logger = logger;
		this.connector = new HttpConnector();
	}

	public start(): Promise<void> {
		return new Promise((resolve, reject) => {
				this.patternplateProcess = fork(path.join(__dirname, 'patternplate-process'), [], {
					cwd: vscode.workspace.rootPath,
					env: process.env,
					execArgv: []
				});
				this.patternplateProcess.send({
					type: 'start',
					cwd: vscode.workspace.rootPath
				} as RPC.Start);
				this.patternplateProcess.on('message', (message: RPC.Message) => {
					switch (message.type) {
						case 'log':
							console.log.apply(console, (message as RPC.Log).args);
							break;
						case 'started':
							resolve((message as RPC.Started).port);
							break;
						case 'error':
							vscode.window.showErrorMessage((message as RPC.Error).error);
							break;
					}
				});
				this.patternplateProcess.on('close', (code: number, signal: string) => {
					console.log(`on close [code=${code}, signal=${signal}]`);
				});
				this.patternplateProcess.on('disconnect', () => {
					console.log(`on disconnect`);
				});
				this.patternplateProcess.on('error', (error: Error) => {
					console.log(`on error ${error.message}`);
					console.error(error);
				});
				this.patternplateProcess.on('exit', (code: number, signal: string) => {
					console.log(`on exit [code=${code}, signal=${signal}]`);
				});
			})
			.then((port: string) => {
				this.base = `http://localhost:${port}`;
			});
	}

	public stop() {
		if (this.patternplateProcess) {
			this.patternplateProcess.kill();
		}
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
			return this.connector
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

	public getPatternIds(): Promise<string[]> {
		const getIdsFromFolder = (obj): string[] => {
			return Object.keys(obj.children)
				.map(key => obj.children[key])
				.filter(entry => entry.type === 'pattern')
				.map(entry => entry.id);
		};
		const getFolders = (obj): any[] => {
			return Object.keys(obj)
				.map(key => obj[key])
				.filter(entry => entry.type === 'folder')
				.reduce((list, entry) => {
					list.push(entry);
					list.push.apply(list, getFolders(Object.keys(entry.children).map(key => entry.children[key])))
					return list;
				}, []);
		};
		const getIds = (obj): string[] => {
			return getFolders(obj)
				.reduce((list, folder) => {
					list.push.apply(list, getIdsFromFolder(folder));
					return list;
				}, []);
		}

		return this.connector.requestFile(`${this.base}/api/meta`, 'application/json')
			.then(data => JSON.parse(data))
			.then(data => getIds(data));
	}

}

class HttpConnector {

	public render(base: string, patternId: string): Promise<string> {
		return Promise.resolve()
			.then(() => {
				return this.requestFile(`${base}/demo/${patternId}`, 'text/html')
					.then(body => {
						// Inline the CSS (vscode does not reload it on changes)
						const cssPath = body.match(/<link rel="stylesheet" href="([^"]+)">/);
						return this.requestFile(`${base}${cssPath[1]}`, 'text/css')
							.then(css => {
								const html = body
									.replace(/<link rel="stylesheet" href="([^"]+)">/, `
										<style type="text/css">
											${css}
										</style>
									`)
									// Set default background
									.replace(/<head>/, `
										<head>
											<base href="${base}/">
											<style type="text/css">
												body {
													background-color: #fff;
												}
											</style>
									`);
								return html;
							});
					});
			});
	}

	public requestFile(fileUrl: string, mimeType: string): Promise<string> {
		console.log(`loading pattern file ${fileUrl} of type ${mimeType}`);
		return new Promise((resolve, reject) => {
			const options: any = url.parse(fileUrl);
			if (!options.headers) {
				options.headers = {};
			}
			options.headers['Accept'] = mimeType;

			http.get(options, res => {
				let body = '';
				res.on('data', (data: any) => {
					body += data.toString();
				});
				res.on('end', () => {
					resolve(body);
				});
				res.resume();
			}).on('error', (e) => {
				reject(e);
			});
		});
	}

}
