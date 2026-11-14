import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

root=Path(__file__).resolve().parent.parent
backend=json.loads((root/'contracts/backend.openapi.json').read_text())
llm=json.loads((root/'contracts/llm.openapi.json').read_text())
assert backend['openapi']==llm['openapi']=='3.1.0'
assert backend['info']['version']==llm['info']['version']==(root/'contracts/VERSION').read_text().strip()
schemas=backend['components']['schemas']
assert schemas==llm['components']['schemas'], 'Common DTO definitions differ'
for definition in schemas.values(): Draft202012Validator.check_schema(definition)

def refs(value):
    if isinstance(value,dict):
        if '$ref' in value:
            assert value['$ref'].startswith('#/components/schemas/')
            assert value['$ref'].split('/')[-1] in schemas, value['$ref']
        for item in value.values(): refs(item)
    elif isinstance(value,list):
        for item in value: refs(item)

for spec in [backend,llm]:
    refs(spec)
    operation_ids=[operation['operationId'] for path in spec['paths'].values() for operation in path.values()]
    assert len(operation_ids)==len(set(operation_ids))
manifest=json.loads((root/'fixtures/manifest.json').read_text())
for item in manifest:
    data=json.loads((root/'fixtures'/item['file']).read_text())
    schema={'$schema':'https://json-schema.org/draft/2020-12/schema', 'components':{'schemas':schemas}, '$ref':'#/components/schemas/'+item['schema']}
    errors=list(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(data))
    assert not errors,(item['file'],[(list(e.path),e.message) for e in errors])
print(f'Valid contracts {backend["info"]["version"]}, {len(schemas)} shared schemas, {len(manifest)} fixtures')
