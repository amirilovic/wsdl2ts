#!/usr/bin/env node
import * as soap from 'soap';
import { saveTs } from './ts-serializer';
import { parseWsdl } from './wsdl-parser';
import { program } from 'commander';
import * as path from 'path';

program
  .requiredOption('-u, --url <value>', 'WSDL url')
  .option(
    '-o, --outputPath <value>',
    'Folder path where to save typescript source files'
  )
  .on('--help', () => {
    console.log('');
    console.log('Examples:');
    console.log(
      ` wsdl2ts -o ./generated -u "https://www.example.com/service.svc?WSDL"`
    );
    console.log('');
  })
  .parse(process.argv);

export type Options = {
  url: string;
  outputPath: string;
};

async function wsdlToTs({ url, outputPath }: Options) {
  const client = await soap.createClientAsync(url);
  const wsdl: soap.WSDL = client['wsdl'];
  const parserResult = parseWsdl(wsdl);
  await saveTs(parserResult, { outputPath });
}

const url = program.url;
const outputPath = program.outputPath;

wsdlToTs({ url, outputPath })
  .then(() =>
    console.log(`typescript source files saved to: ${path.resolve(outputPath)}`)
  )
  .catch(console.error);
