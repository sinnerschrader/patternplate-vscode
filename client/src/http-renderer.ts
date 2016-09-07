import * as http from 'http';
import * as url from 'url';

export class HttpRenderer {

	public render(base: string, patternId: string): Promise<string> {
		return Promise.resolve()
			.then(() => {
				return this.loadPatternFile(`${base}/demo/${patternId}`, 'text/html')
					.then(body => {
						// Inline the CSS (vscode does not reload it on changes)
						const cssPath = body.match(/<link rel="stylesheet" href="([^"]+)">/);
						return this.loadPatternFile(`${base}${cssPath[1]}`, 'text/css')
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
