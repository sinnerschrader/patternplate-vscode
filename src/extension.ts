'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as lsClient from 'vscode-languageclient';
import * as http from 'http';
import * as url from 'url';
import { Logger } from './logger';
import { createAdapter, PatternplateAdapter } from './patternplate-adapter';
import parseJson, * as JsonastTypes from 'jsonast';

let patternplateAdapter: PatternplateAdapter;
let logger: Logger;

export function activate(context: vscode.ExtensionContext) {
	const channel = vscode.window.createOutputChannel('patternplate')
	context.subscriptions.push(channel);
	let disposable = vscode.commands.registerCommand('patternplate.showConsole', () => {
		channel.show(true);
	});
	context.subscriptions.push(disposable);

	logger = new Logger(channel);
	patternplateAdapter = createAdapter(logger);
	patternplateAdapter
		.start()
		.then(() => {
			let disposable = vscode.commands.registerCommand('patternplate.restart', () => {
				patternplateAdapter.stop().then(() => patternplateAdapter.start());
			});
			context.subscriptions.push(disposable);
			disposable = vscode.commands.registerCommand('patternplate.open', () => {
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

			const provider = new PatternplateDemoContentProvider(patternplateAdapter);
			disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate-demo', provider);
			context.subscriptions.push(disposable);
			vscode.workspace.onDidSaveTextDocument(document => updateDemo(document, provider));
			// Note: Currently patternplate support only saved documents
			// vscode.workspace.onDidChangeTextDocument(event => updateDemo(event.document, provider));
			// vscode.workspace.onDidChangeConfiguration(() =>
			// vscode.workspace.textDocuments.forEach(document => updateDemo(document, provider)));

			disposable = vscode.languages.registerCompletionItemProvider(
				{ language: 'json', pattern: '**/pattern.json' },
				new PatternManifestCompletionItemProvider(patternplateAdapter));
			context.subscriptions.push(disposable);
			disposable = vscode.languages.registerDocumentLinkProvider(
				{ language: 'json', pattern: '**/pattern.json' },
				new PatternManifestLinkProvider());
			context.subscriptions.push(disposable);
			disposable = vscode.languages.registerHoverProvider(
				{ language: 'json', pattern: '**/pattern.json' },
				new PatternDocumentationHoverProvider());
			context.subscriptions.push(disposable);
			disposable = vscode.languages.registerReferenceProvider(
				{ language: 'json', pattern: '**/pattern.json' },
				new PatternReferenceProvider(patternplateAdapter));
			context.subscriptions.push(disposable);

			disposable = vscode.commands.registerCommand('patternplate.showDemo', showDemo);
			context.subscriptions.push(disposable);

			disposable = vscode.commands.registerCommand('patternplate.showDemoToSide',
				(uri: vscode.Uri) => showDemo(uri, true));
			context.subscriptions.push(disposable);
		});
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
	const patternId = document.uri.fsPath.match(/.*\/patterns\/([^\/]+(?:\/[^\/]+)?)\/.*/);
	return hasPatternManifest && patternId && document.uri.scheme !== 'patternplate-demo';
}

function getPatternplateDemoUri(uri: vscode.Uri): vscode.Uri {
	const patternId = uri.fsPath.match(/.*\/patterns\/([^\/]+(?:\/[^\/]+)?)\/.*/);
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
	logger.info(`Pattern URI: ${resource.toString()}`);
	const demoUri = getPatternplateDemoUri(resource);
	logger.info(`Demo URI: ${demoUri.toString()}`);
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

function getPatternName(
	document: vscode.TextDocument | JsonastTypes.JsonObject): { pos: JsonastTypes.Position; value: string; } {
	let ast: JsonastTypes.JsonObject;
	if ((document as vscode.TextDocument).uri) {
		ast = parseJson<JsonastTypes.JsonObject>((document as vscode.TextDocument).getText());
	} else {
		ast = document as JsonastTypes.JsonObject;
	}
	const name = ast.members.find(value => value.key.value === 'name');
	return {
		pos: name.value.pos,
		value: (name.value as JsonastTypes.JsonString).value
	};
}

function getPatternDependencies(
	document: vscode.TextDocument | JsonastTypes.JsonObject): { pos: JsonastTypes.Position; value: string; }[] {
	let ast: JsonastTypes.JsonObject;
	if ((document as vscode.TextDocument).uri) {
		ast = parseJson<JsonastTypes.JsonObject>((document as vscode.TextDocument).getText());
	} else {
		ast = document as JsonastTypes.JsonObject;
	}
	const patternsMember = ast.members
		.find(member => member.key.value === 'patterns');
	return (patternsMember.value as JsonastTypes.JsonObject).members
		.map(member => member.value as JsonastTypes.JsonString)
		.map(dependency => ({
			pos: dependency.pos,
			value: dependency.value
		}));
}

function loadFile(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.exists(path, exists => {
			if (!exists) {
				return reject(undefined);
			}
			fs.readFile(path, (err, data) => {
				if (err) {
					return reject(undefined);
				}
				resolve(data.toString());
			});
		});
	});
}

function jsonastPositionToRange(position: JsonastTypes.Position): vscode.Range {
	return new vscode.Range(position.start.line - 1, position.start.column,
		position.end.line - 1, position.end.column - 2);
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
		return this.patternplateAdapter.getPatternIds()
			.then(patterns => {
				const range = this.getDependencyRange(doc, position);
				if (!range) {
					return [];
				}
				return patterns
					.map(patternId => ({
						label: patternId,
						kind: vscode.CompletionItemKind.Text,
						textEdit: vscode.TextEdit.replace(jsonastPositionToRange(range), patternId)
					} as vscode.CompletionItem));
			})
			.catch(e => {
				console.error(e);
				vscode.window.showErrorMessage(e);
			});
	}

	private getDependencyRange(doc: vscode.TextDocument, position: vscode.Position): JsonastTypes.Position {
		return getPatternDependencies(doc)
			.map(dependency => dependency.pos)
			.find(range => this.isInsideRange(doc.offsetAt(position), range));
	}

	private isInsideRange(offset: number, range: JsonastTypes.Position): boolean {
		return range.start.char < offset && offset < range.end.char;
	}

}

class PatternManifestLinkProvider implements vscode.DocumentLinkProvider {

	public provideDocumentLinks(document: vscode.TextDocument,
		token: vscode.CancellationToken): vscode.DocumentLink[] | Promise<vscode.DocumentLink[]> {
		return getPatternDependencies(document)
			.map(dependency => {
				const uriParts = document.uri.path.match('(.*/patterns/).*');
				const uri = document.uri.with({
					path: `${uriParts[1]}${dependency.value}/pattern.json`
				});
				return new vscode.DocumentLink(jsonastPositionToRange(dependency.pos), uri);
			});
	}

}

class PatternDocumentationHoverProvider implements vscode.HoverProvider {

	public provideHover(document: vscode.TextDocument, position: vscode.Position,
		token: vscode.CancellationToken): vscode.Hover | Promise<vscode.Hover> {
		const dependency = getPatternDependencies(document)
			.find(dependency => this.isInsideRange(document.offsetAt(position), dependency.pos));
		if (!dependency) {
			return undefined;
		}
		const uriParts = document.uri.path.match('(.*/patterns/).*');
		const path = `${uriParts[1]}${dependency.value}/index.md`;
		return loadFile(path)
			.then(text => {
				if (text.length > 200) {
					text = text.substr(0, 200) + '...';
				}
				return new vscode.Hover(text, jsonastPositionToRange(dependency.pos));
			});
	}

	private isInsideRange(offset: number, range: JsonastTypes.Position): boolean {
		return range.start.char < offset && offset < range.end.char;
	}

}

class PatternReferenceProvider implements vscode.ReferenceProvider {

	private patternplateAdapter: PatternplateAdapter;

	constructor(patternplateAdapter: PatternplateAdapter) {
		this.patternplateAdapter = patternplateAdapter;
	}

	public provideReferences(document: vscode.TextDocument, position: vscode.Position,
		context: vscode.ReferenceContext,
		token: vscode.CancellationToken): vscode.Location[] | Promise<vscode.Location[]> {
		// Fixme: this is quite ugly...
		const ast = parseJson<JsonastTypes.JsonObject>(document.getText());
		let name = getPatternName(ast);
		if (!this.isInsideRange(document.offsetAt(position), name.pos)) {
			name = undefined;
		} else {
			name.value = document.uri.path.match('.*/patterns/(.*)/pattern.json')[1];
		}
		console.log('name', name.value);
		const dependency = getPatternDependencies(ast)
			.find(dependency => this.isInsideRange(document.offsetAt(position), dependency.pos));
		if (!name && !dependency) {
			return undefined;
		}
		return this.patternplateAdapter.getPatternDependents(name ? name.value : dependency.value)
			.then(dependents => {
				return dependents.map(name => {
					const uriParts = document.uri.path.match('(.*/patterns/).*');
					const uri = document.uri.with({
						path: `${uriParts[1]}${name}/pattern.json`
					});
					// TODO: Give better position/range in target document
					return new vscode.Location(uri, new vscode.Position(0, 0));
				});
			});
	}

	private isInsideRange(offset: number, range: JsonastTypes.Position): boolean {
		return range.start.char < offset && offset < range.end.char;
	}

}
