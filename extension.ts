'use strict';
import * as path from 'path';
import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import * as execa from 'execa';

let patternplate: any;
const port = '1337';

export function activate(context: vscode.ExtensionContext) {
	const provider = new PatternplateDemoContentProvider(context);
	let disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate-demo', provider);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('patternplate.showDemo', showDemo);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('patternplate.showDemoToSide',
		(uri: vscode.Uri) => showDemo(uri, true));
	context.subscriptions.push(disposable);

	vscode.workspace.onDidSaveTextDocument(document => {
		updateDemo(document, provider);
	});
	vscode.workspace.onDidChangeTextDocument(event => {
		updateDemo(event.document, provider);
	});
	vscode.workspace.onDidChangeConfiguration(() => {
		vscode.workspace.textDocuments.forEach(document => {
			if (document.uri.scheme === 'patternplate-demo') {
				provider.update(document.uri);
			}
		});
	});

	console.log(`Starting patternplate in ${vscode.workspace.rootPath}`);
	patternplate = execa('node', ['--harmony', './node_modules/.bin/patternplate', 'start', '--server.port', port], {
		cwd: vscode.workspace.rootPath
	});
	patternplate.catch(error => {
		console.error(error);
		vscode.window.showErrorMessage(error);
	});
}

export function deactivate() {
	if (patternplate) {
		console.log('Stopping patternplate');
		patternplate.kill();
		patternplate = undefined;
	}
}

function updateDemo(document: vscode.TextDocument, provider: PatternplateDemoContentProvider): void {
	if (isPatternplateDemo(document)) {
		provider.update(getPatternplateDemoUri(document.uri));
	}
}

function isPatternplateDemo(document: vscode.TextDocument) {
	return document.uri.scheme !== 'patternplate-demo';
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
	return vscode.commands.executeCommand('vscode.previewHtml', demoUri,
			getViewColumn(sideBySide), `Demo '${demoUri.query}'`)
		.then(success => { }, error => {
			console.warn(error);
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

	private renderer: any;

	constructor(private context: vscode.ExtensionContext) {
		this.context = context;
		this.renderer = this.createRenderer();
	}

	private createRenderer() {
		let firstRender = true;
		return {
			render(patternId: string) {
				return new Promise(resolve => {
					if (firstRender) {
						firstRender = false;
						setTimeout(() => {
							resolve();
						}, 8000);
					} else {
						resolve();
					}
				})
				.then(() => {
					return new Promise(resolve => {
						const base = `http://localhost:${port}`;
						const options: any = url.parse(`${base}/demo/${patternId}`);
						if (!options.headers) {
							options.headers = {};
						}
						options.headers['Accept'] = 'text/html';

						http.get(options, res => {
							let body = '';
							res.on('data', (data: any) => {
								body += data.toString();
							});
							res.on('end', () => {
								resolve(body.replace(/<head>/, `<head><base href="${base}/">`));
							});
							res.resume();
						});
					});
				});
			}
		};
	}

	public update(uri: vscode.Uri): void {
		if (!this.waiting) {
			this.waiting = true;
			setTimeout(() => {
				this.waiting = false;
				this._onDidChange.fire(uri);
			}, 300);
		}
	}

	get onDidChange(): vscode.Event<vscode.Uri> {
		return this._onDidChange.event;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): string | Thenable<string> {
		return this.renderer.render(uri.query);
	}

}
