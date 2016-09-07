'use strict';
import 'babel-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import { Logger } from './logger';
import { createAdapter, PatternplateAdapter } from './patternplate-adapter';

let patternplateAdapter: PatternplateAdapter;

export function activate(context: vscode.ExtensionContext) {
	const channel = vscode.window.createOutputChannel('patternplate')
	context.subscriptions.push(channel);
	let disposable = vscode.commands.registerCommand('patternplate.showConsole', () => {
		channel.show(true);
	});
	context.subscriptions.push(disposable);

	patternplateAdapter = createAdapter(new Logger(channel));
	patternplateAdapter.start();

	const provider = new PatternplateDemoContentProvider(patternplateAdapter);
	disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate-demo', provider);
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

	disposable = vscode.commands.registerCommand('patternplate.open', () => {
		if (patternplateAdapter && patternplateAdapter.isStarted()) {
			vscode.commands.executeCommand('vscode.open', patternplateAdapter.uri);
		}
	});
	context.subscriptions.push(disposable);

	const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	bar.text = 'patternplate';
	bar.command = 'patternplate.open';
	context.subscriptions.push(bar);
	bar.show();
}

export function deactivate() {
	if (patternplateAdapter) {
		patternplateAdapter.stop();
		patternplateAdapter = undefined;
	}
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

	private patternplateAdapter: PatternplateAdapter;

	constructor(patternplateAdapter: PatternplateAdapter) {
		this.patternplateAdapter = patternplateAdapter;
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
		if (!this.patternplateAdapter) {
			throw new Error('No patternplate started');
		}
		return this.patternplateAdapter.renderDemo(uri.query);
	}

}
