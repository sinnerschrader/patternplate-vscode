'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as lsClient from 'vscode-languageclient';
import * as http from 'http';
import * as url from 'url';
import { Logger } from './logger';
import { createAdapter, PatternplateAdapter } from './patternplate-adapter';
import * as jsonToAst from 'json-to-ast';
import * as globby from 'globby';

let patternplateAdapter: PatternplateAdapter;

export function activate(context: vscode.ExtensionContext) {
	const channel = vscode.window.createOutputChannel('patternplate')
	context.subscriptions.push(channel);
	let disposable = vscode.commands.registerCommand('patternplate.showConsole', () => {
		channel.show(true);
	});
	context.subscriptions.push(disposable);

	patternplateAdapter = createAdapter(new Logger(channel));
	patternplateAdapter
		.start()
		.then(() => {
			let disposable = vscode.commands.registerCommand('patternplate.open', () => {
				if (patternplateAdapter && patternplateAdapter.isStarted()) {
					vscode.commands.executeCommand('vscode.open', patternplateAdapter.uri);
				}
			});
			context.subscriptions.push(disposable);

			const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
			bar.text = 'patternplate';
			bar.command = 'patternplate.open';
			bar.show();
			context.subscriptions.push(bar);
		});

	const provider = new PatternplateDemoContentProvider(patternplateAdapter);
	disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate-demo', provider);
	context.subscriptions.push(disposable);

	vscode.languages.registerCompletionItemProvider({ language: 'json', pattern: '**/pattern.json' },
		new PatternManifestCompletionItemProvider(patternplateAdapter));

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
	return uri.with({
		scheme: 'patternplate-demo',
		path: path.dirname(uri.path),
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
		})
	})
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

class PatternManifestCompletionItemProvider implements vscode.CompletionItemProvider {

	private patternplateAdapter: PatternplateAdapter;

	constructor(patternplateAdapter: PatternplateAdapter) {
		this.patternplateAdapter = patternplateAdapter;
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,
			token: vscode.CancellationToken): vscode.CompletionItem[] | Promise<vscode.CompletionItem[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		return Promise.race([
			new Promise(resolve => {
				const disposable = token.onCancellationRequested(() => {
					disposable.dispose();
					resolve([]);
				});
			}),
			this.completionForPatternManifest(document, position)
		])
		.then(winner => winner);
	}

	private completionForPatternManifest(doc: vscode.TextDocument,
			position: vscode.Position): Promise<vscode.CompletionItem[]> {
		return this.getPatterns()
			.then(patterns => {
				const range = this.getDependencyRange(doc, position);
				if (!range) {
					return [];
				}
				const editorRange = new vscode.Range(range.start.line - 1, range.start.column,
					range.end.line - 1, range.end.column - 2);
				return patterns
					.map(patternId => ({
						label: patternId,
						kind: vscode.CompletionItemKind.Text,
						textEdit: vscode.TextEdit.replace(editorRange, patternId)
					} as vscode.CompletionItem));
			})
			.catch(e => {
				console.error(e);
				vscode.window.showErrorMessage(e);
			});
	}

	private getPatterns(): Promise<string[]> {
		return this.patternplateAdapter.getPatternIds();
	}

	private getDependencyRange(doc: vscode.TextDocument, position: vscode.Position): jsonToAst.Position {
		const ast = jsonToAst(doc.getText());
		const dependencies = ast.properties.find(property => property.key.value === 'patterns');
		if (!dependencies || dependencies.value.type !== 'object') {
			return null;
		}
		const dependencyValueRanges = (dependencies.value as jsonToAst.Object).properties
			.map(property => property.value.position);
		return dependencyValueRanges.find(range => this.isInsideRange(doc.offsetAt(position), range));
	}

	private isInsideRange(offset: number, range: jsonToAst.Position): boolean {
		return range.start.char < offset && offset < range.end.char;
	}

}