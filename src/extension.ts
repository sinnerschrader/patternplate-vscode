'use strict';
import 'babel-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';

let patternplateApp: any;
let patternplateBase: string;

export function activate(context: vscode.ExtensionContext) {
	const provider = new PatternplateDemoContentProvider(context);
	let disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate-demo', provider);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('patternplate.showDemo', showDemo);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('patternplate.showDemoToSide',
		(uri: vscode.Uri) => showDemo(uri, true));
	context.subscriptions.push(disposable);

	vscode.workspace.onDidSaveTextDocument(document => updateDemo(document, provider));
	// Note: Currently patternplate support only saved documents
	// vscode.workspace.onDidChangeTextDocument(event => updateDemo(event.document, provider));
	// vscode.workspace.onDidChangeConfiguration(() =>
		// vscode.workspace.textDocuments.forEach(document => updateDemo(document, provider)));


	const channel = vscode.window.createOutputChannel('patternplate')
	context.subscriptions.push(channel);
	disposable = vscode.commands.registerCommand('patternplate.showConsole', () => {
		channel.show(true);
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('patternplate.open', () => {
		if (patternplateBase) {
			vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(patternplateBase));
		}
	});
	context.subscriptions.push(disposable);

	const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	bar.text = 'patternplate';
	bar.command = 'patternplate.open';
	context.subscriptions.push(bar);
	bar.show();

	startPatternplate(channel);
}

export function deactivate() {
}

function startPatternplate(channel: vscode.OutputChannel): void {
	console.log(`Starting patternplate in ${vscode.workspace.rootPath}`);
	process.chdir(vscode.workspace.rootPath);
	const patternplatePath = path.join(vscode.workspace.rootPath, 'node_modules', 'patternplate') || 'patternplate';
	const patternplate = require(patternplatePath);
	patternplate({
		mode: 'server'
	}).then(app => {
		patternplateApp = app;

		// set and freeze logger
		patternplateApp.log.deploy(new Logger(channel));
		patternplateApp.log.deploy = function() {}

		return patternplateApp.start()
			.then(() => app);
	}).then(app => {
		const { host, port } = app.configuration.server;
		patternplateBase = `http://${host}:${port}`;
	}).catch(error => {
		console.error(error);
		vscode.window.showErrorMessage(error.message);
	});
}

function updateDemo(document: vscode.TextDocument, provider: PatternplateDemoContentProvider): void {
	if (isPatternFile(document)) {
		provider.update(getPatternplateDemoUri(document.uri));
	}
}

function isPatternFile(document: vscode.TextDocument): boolean {
	const folder = path.dirname(document.uri.fsPath);
	const hasPatternManifest = fs.existsSync(path.join(folder, 'pattern.json'));
	const patternId = document.uri.fsPath.match(/.*\/patterns\/([^\/]+\/[^\/]+)\/.*/);
	return hasPatternManifest && patternId && document.uri.scheme !== 'patternplate-demo';
}

function getPatternplateDemoUri(uri: vscode.Uri): vscode.Uri {
	const patternId = uri.fsPath.match(/.*\/patterns\/([^\/]+\/[^\/]+)\/.*/);
	return (uri as any).with({
		scheme: 'patternplate-demo',
		path: path.dirname(uri.path),
		fsPath: path.dirname(uri.fsPath),
		query: patternId[1]
	});
}

function showDemo(uri: vscode.Uri, sideBySide: boolean = false): Thenable<any> {
	var resource = uri;
	if (!(resource instanceof vscode.Uri)) {
		if (vscode.window.activeTextEditor) {
			resource = vscode.window.activeTextEditor.document.uri;
		}
	}
	if (!(resource instanceof vscode.Uri)) {
		return;
	}
	const demoUri = getPatternplateDemoUri(resource);
	return new Promise((resolve, reject) => {
		fs.readFile(path.join(demoUri.fsPath, 'pattern.json'), (err, data) => {
			if (err) {
				return reject(err);
			}
			resolve(JSON.parse(data.toString()));
		})})
	.then((patternManifest: any) => {
		const name = patternManifest.displayName || patternManifest.name || demoUri.query;
		return vscode.commands.executeCommand(
			'vscode.previewHtml', demoUri, getViewColumn(sideBySide), `${name} Demo`);
	})
	.catch(error => {
		console.error(error);
		vscode.window.showErrorMessage(error);
	});
}

function getViewColumn(sideBySide: boolean): vscode.ViewColumn {
	var active = vscode.window.activeTextEditor;
	if (!active) {
		return vscode.ViewColumn.One;
	}
	if (!sideBySide) {
		return active.viewColumn;
	}
	switch (active.viewColumn) {
		case vscode.ViewColumn.One:
			return vscode.ViewColumn.Two;
		case vscode.ViewColumn.Two:
			return vscode.ViewColumn.Three;
	}
	return active.viewColumn;
}

class PatternplateDemoContentProvider implements vscode.TextDocumentContentProvider {

	public _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();

	private waiting: boolean = false;

	private renderer: PatternRenderer;

	constructor(private context: vscode.ExtensionContext) {
		this.context = context;
		this.renderer = new PatternRenderer();
	}

	public update(uri: vscode.Uri): void {
		if (!this.waiting) {
			this.waiting = true;
			setTimeout(() => {
				this.waiting = false;
				this._onDidChange.fire(uri);
			}, 150);
		}
	}

	get onDidChange(): vscode.Event<vscode.Uri> {
		return this._onDidChange.event;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): string | Thenable<string> {
		return this.renderer.render(uri.query);
	}

}

class PatternRenderer {

	private firstRender = true;

	private retries = 0;

	public render(patternId: string): Promise<string> {
		return Promise.resolve()
			.then(() => {
				return this.loadPatternFile(`${patternplateBase}/demo/${patternId}`, 'text/html')
					.then(body => {
						// Inline the CSS (vscode does not reload it on changes)
						const cssPath = body.match(/<link rel="stylesheet" href="([^"]+)">/);
						return this.loadPatternFile(`${patternplateBase}${cssPath[1]}`, 'text/css')
							.then(css => {
								this.firstRender = false;
								const html = body
									.replace(/<link rel="stylesheet" href="([^"]+)">/, `
										<style type="text/css">
											${css}
										</style>
									`)
									// Set default background
									.replace(/<head>/, `
										<head>
											<base href="${patternplateBase}/">
											<style type="text/css">
												body {
													background-color: #fff;
												}
											</style>
									`);
								return html;
							});
					});
			})
			.catch(error => {
				if (this.firstRender && this.retries < 10) {
					this.retries++;
					return new Promise(resolve => {
						setTimeout(() => {
							resolve(this.render(patternId));
						}, 1000);
					});
				}
				throw error;
			});
	}

	private loadPatternFile(fileUrl: string, mimeType: string): Promise<string> {
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

class Logger {

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
