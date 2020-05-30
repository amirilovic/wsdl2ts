import * as soap from 'soap';
import {
  ComplexContentElement,
  ComplexTypeElement,
  Element,
  ElementElement,
  EnumerationElement,
  ExtensionElement,
  InputElement,
  OperationElement,
  OutputElement,
  PortTypeElement,
  RestrictionElement,
  SchemaElement,
  SequenceElement,
  SimpleTypeElement,
  AnyElement
} from 'soap/lib/wsdl/elements';

export interface TsField {
  name: string;
  type: string;
}

export interface TsFunction {
  name: string;
  input: TsField;
  outputType: string;
}

export interface TsInterface {
  name: string;
  extends?: string;
  fields: TsField[];
  functions: TsFunction[];
}

export interface TsEnum {
  name: string;
  base?: string;
  values: string[];
}

export interface TsFile {
  name: string;
  interfaces: TsInterface[];
  importedTypes: Record<string, Set<string>>;
  enums: TsEnum[];
}

export interface ParserResult {
  files: TsFile[];
}

function namespaceToFilePath(namespace: string) {
  const uri = new URL(namespace);
  return uri.hostname + uri.pathname + '/index.ts';
}

function mapFieldType(schemaType: string) {
  if (schemaType === 'dateTime') {
    return 'Date';
  }

  if (schemaType === 'base64Binary') {
    return 'number[]';
  }

  if (schemaType === 'duration') {
    return 'string';
  }

  if (
    [
      'int',
      'integer',
      'negativeInteger',
      'nonNegativeInteger',
      'nonPositiveInteger',
      'positiveInteger',
      'double',
      'decimal',
      'float',
      'byte',
      'short',
      'long',
      'unsignedLong',
      'unsignedInt',
      'unsignedShort',
      'unsignedByte'
    ].includes(schemaType)
  ) {
    return 'number';
  }

  return schemaType;
}

function findInterfaceInFile(
  tsFile: TsFile,
  name: string
): TsInterface | undefined {
  return tsFile.interfaces.find(tsInterface => tsInterface.name == name);
}

function findEnumInFile(tsFile: TsFile, name: string): TsEnum | undefined {
  return tsFile.enums.find(tsEnum => tsEnum.name == name);
}

function getTypeFromFile(tsFile: TsFile, name: string) {
  if (findInterfaceInFile(tsFile, name)) {
    return name;
  }
  const tsEnum = findEnumInFile(tsFile, name);
  if (tsEnum) {
    return name;
  }
}

function parseElement(
  parserResult: ParserResult,
  tsFile: TsFile,
  tsCurrentInterface: TsInterface,
  element: Element
) {
  if (element instanceof ElementElement) {
    if (element.$type) {
      const [ns, rawType] = element.$type.split(':');
      // <xs:element xmlns:q1="http://www.example.com/schema" minOccurs="0" name="Result" nillable="true" type="q1:ResultType"/>
      if (element.xmlns && element.xmlns[ns]) {
        const namespace = element.xmlns[ns];
        const filePath = namespaceToFilePath(namespace);
        if (!tsFile.importedTypes[filePath]) {
          tsFile.importedTypes[filePath] = new Set();
        }
        tsFile.importedTypes[filePath].add(rawType);
      }

      // <xs:element minOccurs="0" name="Result" nillable="true" type="tns:ResultType"/>
      let type = getTypeFromFile(tsFile, rawType);

      // <xs:element minOccurs="0" name="Result" nillable="true" type="xs:string"/>
      type = type ?? rawType;
      const isArray = element.$maxOccurs === 'unbounded';
      const isNillable = (element as any).$nillable == 'true';
      const name = element.$name + (isNillable ? '?' : '');
      tsCurrentInterface.fields.push({
        name,
        type: `${mapFieldType(type)}${isArray ? '[]' : ''}`
      });
    } else {
      const tsInterface: TsInterface = {
        name: tsCurrentInterface
          ? [tsCurrentInterface.name, element.$name].join('_')
          : element.$name,
        fields: [
          {
            name: '$attributes?',
            type:
              '{ $xsiType?: {type: string; xmlns: string}; [key:string]: any; }'
          }
        ],
        functions: []
      };
      tsFile.interfaces.push(tsInterface);
      if (tsCurrentInterface) {
        tsCurrentInterface.fields.push({
          name: element.$name,
          type: tsInterface.name
        });
      }
      tsCurrentInterface = tsInterface;
    }
  } else if (element instanceof AnyElement) {
    tsCurrentInterface.fields = [];
    tsCurrentInterface.extends = `Record<string, any>`;
  } else if (element instanceof ComplexTypeElement) {
    if (element.$name) {
      const tsInterface: TsInterface = {
        name: element.$name,
        functions: [],
        fields: [
          {
            name: '$attributes?',
            type:
              '{ $xsiType?: {type: string; xmlns: string}; [key:string]: any; }'
          }
        ]
      };
      tsFile.interfaces.push(tsInterface);
      tsCurrentInterface = tsInterface;
    }
  } else if (element instanceof ExtensionElement) {
    tsCurrentInterface.extends = element.$base.split(':')[1];
  }

  element.children.forEach(child =>
    parseElement(parserResult, tsFile, tsCurrentInterface, child)
  );
}

function parseSimpleType(
  tsFile: TsFile,
  tsCurrentEnum: TsEnum,
  element: Element
) {
  if (element instanceof SimpleTypeElement) {
    if (element.$name) {
      const tsEnum: TsEnum = {
        name: element.$name,
        values: []
      };
      tsFile.enums.push(tsEnum);
      tsCurrentEnum = tsEnum;
    }
  } else if (element instanceof RestrictionElement) {
    tsCurrentEnum.base = mapFieldType(element.$base.split(':')[1]);
  } else if (element instanceof EnumerationElement) {
    tsCurrentEnum.values.push(element.description());
  } else if (element.name == 'list') {
    tsCurrentEnum.base = 'string';
    return;
  }

  element.children.forEach(child =>
    parseSimpleType(tsFile, tsCurrentEnum, child)
  );
}

function parseSchema(parserResult: ParserResult, schemaElement: SchemaElement) {
  const file: TsFile = {
    name: namespaceToFilePath(schemaElement.$targetNamespace),
    interfaces: [],
    enums: [],
    importedTypes: {}
  };

  Object.values(schemaElement.types).forEach(simpleType =>
    parseSimpleType(file, null, simpleType)
  );

  Object.values(schemaElement.complexTypes).forEach(complexType =>
    parseElement(parserResult, file, null, complexType)
  );

  parserResult.files.push(file);
}

function parseOperationInput(
  parserResult: ParserResult,
  file: TsFile,
  input: InputElement
): TsField {
  parseElement(parserResult, file, null, input);
  return { name: 'input', type: input.$name };
}
function parseOperationOutput(
  parserResult: ParserResult,
  file: TsFile,
  output: OutputElement
): string {
  parseElement(parserResult, file, null, output);
  return output.$name;
}

function parseOperation(
  parserResult: ParserResult,
  file: TsFile,
  operation: OperationElement
): TsFunction {
  const tsFunction: TsFunction = {
    name: operation.$name,
    input: parseOperationInput(parserResult, file, operation.input),
    outputType: parseOperationOutput(parserResult, file, operation.output)
  };
  return tsFunction;
}

function parsePortType(
  parserResult: ParserResult,
  name: string,
  portType: PortTypeElement
) {
  const tsFile: TsFile = {
    name: `${name}.ts`,
    interfaces: [],
    enums: [],
    importedTypes: {}
  };

  const tsInterface: TsInterface = {
    name: name,
    functions: Object.values(portType.methods).map(operationElement =>
      parseOperation(parserResult, tsFile, operationElement)
    ),
    fields: []
  };

  tsFile.interfaces.push(tsInterface);
  parserResult.files.push(tsFile);

  return tsFile;
}

export function parseWsdl(wsdl: soap.WSDL): ParserResult {
  const result: ParserResult = {
    files: []
  };
  Object.values(wsdl.definitions.schemas).forEach(schemaElement =>
    parseSchema(result, schemaElement)
  );

  Object.entries(wsdl.definitions.portTypes).forEach(([name, portType]) =>
    parsePortType(result, name, portType)
  );

  return result;
}
