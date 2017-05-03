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
	getPatternDependencies(): Promise<{[patternId: string]: {[locallId: string]: string}}>;
	getPatternDependents(patternId:string): Promise<string[]>;
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

	private getFolders(obj: any): any[] {
		return Object.keys(obj)
			.map(key => obj[key])
			.filter(entry => entry.type === 'folder')
			.reduce((list, entry) => {
				list.push(entry);
				list.push.apply(list, this.getFolders(Object.keys(entry.children).map(key => entry.children[key])))
				return list;
			}, []);
	}

	public getPatternIds(): Promise<string[]> {
		const getIdsFromFolder = (obj): string[] => {
			return Object.keys(obj.children)
				.map(key => obj.children[key])
				.filter(entry => entry.type === 'pattern')
				.map(entry => entry.id);
		};
		const getFromPattern = (obj, fn: (obj: any) => any[]): string[] => {
			return this.getFolders(obj)
				.reduce((list, folder) => {
					list.push.apply(list, fn(folder));
					return list;
				}, []);
		}
		return this.getMetaData()
			.then(data => getFromPattern(data, getIdsFromFolder))
			.catch(error => []);
	}

	public getPatternDependencies(): Promise<{[patternId: string]: {[locallId: string]: string}}> {
		const getDependenciesFromFolder = (obj): {[patternId: string]: {[locallId: string]: string}} => {
			return Object.keys(obj.children)
				.map(key => obj.children[key])
				.filter(entry => entry.type === 'pattern')
				.map(entry => [entry.id, entry.manifest.patterns])
				.reduce((res, pat) => {
					res[pat[0]] = pat[1];
					return res;
				}, {} as {[patternId: string]: {[locallId: string]: string}});
		};
		const getFromPattern = (obj, fn: (obj: any) => any): {[patternId: string]: {[locallId: string]: string}} => {
			return this.getFolders(obj)
				.reduce((res, folder) => {
					const temp = fn(folder);
					Object.keys(temp).forEach(key => {
						res[key] = temp[key] || {};
					});
					return res;
				}, {} as {[patternId: string]: {[locallId: string]: string}});
		}
		return this.getMetaData()
			.then(data => getFromPattern(data, getDependenciesFromFolder))
			.catch(error => ({}));
	}

	public getPatternDependents(patternId:string): Promise<string[]> {
		return this.getPatternDependencies()
			.then(dependencies => {
				return Object.keys(dependencies).map(name => {
						return Object
								.keys(dependencies[name])
								.map(local => dependencies[name][local])
								.indexOf(patternId) > -1
							? name
							: false;
					})
					.filter(name => Boolean(name));
			})
			.catch(error => []);
	}

	private getMetaData(): Promise<any> {
		return this.connector.requestFile(`${this.base}/api/meta`, 'application/json')
			.then(data => JSON.parse(data));
	}

}

class HttpConnector {

	public render(base: string, patternId: string): Promise<string> {
		return this.requestFile(`${base}/demo/${patternId}`, 'text/html')
			.then(body => this.patchBaseAndBackground(base, body))
			.then(body => {
				// Inline the CSS (vscode does not reload it on changes)
				const cssPath = body.match(/<link rel="stylesheet" href="([^"]+)">/);
				if (cssPath) {
					let cssUri = cssPath[1];
					if (cssUri.startsWith('./')) {
						cssUri = `/demo/${patternId}/${cssUri.replace(/^\.\//, '')}`;
					}
					return this.requestFile(`${base}${cssUri}`, 'text/css')
						.then(css => {
							return body
								.replace(/<link rel="stylesheet" href="([^"]+)">/, `
									<style type="text/css">
										${css}
									</style>
								`);
						});
				}
				return body;
			});
	}

	private patchBaseAndBackground(base: string, html: string): string {
		return html.replace(/<head>/, `
			<head>
				<base href="${base}/">
				<style type="text/css">
					body {
						background-color: #fff;
					}
				</style>
		`);
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
