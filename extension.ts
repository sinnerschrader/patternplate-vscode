'use strict';
import { exists } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PatternplateDemoContentProvider(context);
    let disposable = vscode.workspace.registerTextDocumentContentProvider('patternplate', provider);
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
}

export function deactivate() {
}

function updateDemo(document: vscode.TextDocument, provider: PatternplateDemoContentProvider): void {
    if (isPatternplateDemo(document)) {
        provider.update(getPatternplateDemoUri(document.uri));
    }
}

function isPatternplateDemo(document: vscode.TextDocument) {
    return document.languageId === 'patternplate'
        && document.uri.scheme !== 'patternplate-demo';
}

function getPatternplateDemoUri(uri: vscode.Uri): vscode.Uri {
    return Object.assign({}, uri, {
        scheme: 'patternplate-demo',
        path: uri.path,
        query: uri.toString()
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
	const testUri = vscode.Uri.parse(`patternplate://demo/home/marwol/source/vw/vwa-patternplate/patterns/atoms/button/index.jsx`);
	console.log('SHOW PREVIEW', resource, getPatternplateDemoUri(resource), testUri);
    return vscode.commands.executeCommand('vscode.previewHtml', /*getPatternplateDemoUri(resource)*/ testUri,
        	getViewColumn(sideBySide), "Preview '" + path.basename(resource.fsPath) + "'")
		.then(success => {}, error => {
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

    private context: vscode.ExtensionContext;

    private waiting: boolean = false;

    private renderer: any;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.renderer = this.createRenderer();
    }

    private createRenderer() {
        return {
            render(text: string) {
                return text;
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
        return vscode.workspace.openTextDocument(vscode.Uri.parse(uri.query)).then((document) => {
            return `
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
                        <base href="${document.uri.toString()}">
                    </head>
                    <body>
                        ${this.renderer.render(document.getText())}
                    </body>
                </html>
            `;
        });
    }

}
