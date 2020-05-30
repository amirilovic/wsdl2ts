import * as path from 'path';
import { Project, SourceFile } from 'ts-morph';
import { ParserResult, TsEnum, TsFile, TsInterface } from 'wsdl-parser';

const project = new Project({
  tsConfigFilePath: path.resolve(path.join(__dirname, '..', 'tsconfig.json')),
  addFilesFromTsConfig: false
});

const addInterface = (sourceFile: SourceFile) => (tsInterface: TsInterface) => {
  const interfaceDeclaration = sourceFile.addInterface({
    name: tsInterface.name,
    isExported: true
  });

  if (tsInterface.extends) {
    interfaceDeclaration.addExtends(tsInterface.extends);
  }

  tsInterface.fields.forEach(field =>
    interfaceDeclaration.addProperty({ name: field.name, type: field.type })
  );

  tsInterface.functions.forEach(fn => {
    interfaceDeclaration.addMethod({
      name: fn.name,
      returnType: `Promise<{result:${fn.outputType}, envelope: string}>`,
      parameters: [{ name: fn.input.name, type: fn.input.type }]
    });
  });
};

const addEnum = (sourceFile: SourceFile) => (tsEnum: TsEnum) => {
  if (tsEnum.values.length == 0) {
    sourceFile.addTypeAlias({
      isExported: true,
      name: tsEnum.name,
      type: tsEnum.base
    });
  } else {
    sourceFile.addEnum({
      isExported: true,
      name: tsEnum.name,
      members: tsEnum.values.map(val => ({ value: val, name: val }))
    });
  }
};

const addFile = (project: Project, outputFolder: string) => (
  tsFile: TsFile
) => {
  const sourceFile = project.createSourceFile(
    path.join(outputFolder, tsFile.name),
    '',
    {
      overwrite: true
    }
  );

  tsFile.interfaces.forEach(addInterface(sourceFile));
  tsFile.enums.forEach(addEnum(sourceFile));
  return sourceFile;
};

function resolveImports(
  project: Project,
  tsFiles: TsFile[],
  outputFolder: string
) {
  tsFiles.forEach(tsFile => {
    const sourceFile = project.getSourceFile(
      path.join(outputFolder, tsFile.name)
    );
    Object.keys(tsFile.importedTypes!)
      .map(filePath => {
        return {
          importedSourceFile: project.getSourceFile(
            path.join(outputFolder, filePath)
          ),
          filePath
        };
      })
      .forEach(({ importedSourceFile, filePath }) => {
        const importDeclaration = sourceFile.addImportDeclaration({
          moduleSpecifier: '.'
        });

        importDeclaration.setModuleSpecifier(importedSourceFile);
        importDeclaration.addNamedImports(
          Array.from(tsFile.importedTypes[filePath])
        );
      });
  });
}

export interface SerializationOptions {
  outputPath?: string;
}

export function saveTs(
  parserResult: ParserResult,
  options: SerializationOptions = { outputPath: 'generated' }
) {
  const { outputPath } = options;

  parserResult.files.map(addFile(project, outputPath));
  resolveImports(project, parserResult.files, outputPath);

  return Promise.all(
    project.getSourceFiles().map(sourceFile => sourceFile.save())
  );
}
