
import Immutable from 'immutable';
import {take, put, select, call} from 'redux-saga/effects';
import React from 'react';
import {Nav, NavDropdown, MenuItem} from 'react-bootstrap';
import EpicComponent from 'epic-component';
import Select from 'react-select';

import {documentFromString} from '../buffers/document';

const examples = [

  {
    title: "analogRead",
    source: [
      "void setup() {",
      "    pinMode(14, INPUT);",
      "}",
      "void loop() {",
      "   int n = analogRead(14);",
      "   Serial.println(n);",
      "   delay(1000);",
      "}",
    ].join('\n'),
    mode: 'arduino'
  },

  {
    title: "Serial.print",
    source: [
      "void setup() {",
      "    Serial.begin(9600);",
      "}",
      "void loop() {",
      "    Serial.print(\"Hello, \");",
      "    Serial.println(\"world!\");",
      "    Serial.println('1');",
      "    Serial.println(2);",
      "    Serial.println(31, HEX);",
      "    Serial.println(14, DEC);",
      "    Serial.println(55, OCT);",
      "    Serial.println(42, BIN);",
      "}",
    ].join('\n'),
    mode: 'arduino'
  },

  {
    title: "blink (2 LEDs)",
    source: [
      "#define RED_LED_PIN 0",
      "#define GRN_LED_PIN 1",
      "void setup() {",
      "    pinMode(RED_LED_PIN, OUTPUT);",
      "    pinMode(GRN_LED_PIN, OUTPUT);",
      "}",
      "int level = LOW;",
      "void loop() {",
      "    digitalWrite(GRN_LED_PIN, level);",
      "    digitalWrite(RED_LED_PIN, level ^ HIGH);",
      "    level ^= HIGH;",
      "    delay(1000);",
      "}",
    ].join('\n'),
    mode: 'arduino'
  },

  {
    title: "blink",
    source: [
      "#define LED_PIN 0",
      "void setup() {",
      "    pinMode(LED_PIN, OUTPUT);",
      "}",
      "int level = LOW;",
      "void loop() {",
      "    digitalWrite(LED_PIN, level);",
      "    level ^= HIGH;",
      "    delay(1000);",
      "}",
    ].join('\n'),
    mode: 'arduino'
  },

  {
    title: "heartbeat",
    source: [
      "void setup() {",
      "}",
      "void loop() {",
      "   Serial.print('.');",
      "   delay(1000);",
      "}"
    ].join('\n'),
    mode: 'arduino'
  },

  {
    title: "struct + function pointer",
    source: [
      "struct serial_s {",
      "    int (*available)(void);",
      "};",
      "int Serial_available(void) {",
      "    return 42;",
      "}",
      "int main() {",
      "    //! showMemory()",
      "    struct serial_s Serial;",
      "    Serial.available = Serial_available;",
      "    Serial.available();",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "struct",
    source: [
      "struct point {",
      "  int x;",
      "  int y;",
      "};",
      "int main() {",
      "  struct point p, *q = &p;",
      "  int * r;",
      "  p.x = 1;",
      "  q->y = 2;",
      "  r = &p.x;",
      "  *r = 3;",
      "  r = &q->y;",
      "  *r = 4;",
      "  return p.x + p.y;",
      "}"
    ].join('\n')
  },

  {
    title: "scanf %lf %c",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "    double d;",
      "    char c;",
      "    int r;",
      "    r = scanf(\"%lf\", &d);",
      "    r = scanf(\"%c\", &c);",
      "    printf(\"|%lf| |%c|\", d, c);",
      "    return 0;",
      "}"
    ].join('\n'),
    input: "12 a"
  },

  {
    title: "gets/puts",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "    char str[16];",
      "    gets(str);",
      "    printf(\"[%s]\\n\", str);",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "scanf",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "    int a, n;",
      "    n = scanf(\"%d\", &a);",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "allocation dynamique",
    source: [
      "#include <stdlib.h>",
      "int main() {",
      "    //! showMemory(start=272)",
      "    int * p = malloc(4 * sizeof(int));",
      "    int * q = malloc(1 * sizeof(int));",
      "    free(q);",
      "    int * r = malloc(2 * sizeof(int));",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "hello world",
    source: "#include <stdio.h>\nint main() {\n   printf(\"hello, \");\n   printf(\"world! %i\\n\", (2 + 4) * 7);\n}"
  },

  {
    title: "opérateurs unaires",
    source: "#include <stdio.h>\nint main() {\n  int a = 3, *b;\n  printf(\"%i\\n\", +a);\n  printf(\"%i\\n\", -a);\n  printf(\"%i\\n\", !a);\n  printf(\"%i\\n\", ~a);\n  b = &a;\n  printf(\"%i\\n\", *b);\n  printf(\"%lu\\n\", sizeof(a));\n}\n"
  },

  {
    title: "opérateurs binaires",
    source: "#include <stdio.h>\nint main() {\n  printf(\"add %i\\n\", 10 + 2);\n  printf(\"sub %i\\n\", 13 - 1);\n  printf(\"mul %i\\n\", 3 * 4);\n  printf(\"div %i\\n\", 72 / 6);\n  printf(\"rem %i\\n\", 32 % 20);\n  printf(\"and %i\\n\", 15 & 12);\n  printf(\"or  %i\\n\", 4 | 8);\n  printf(\"xor %i\\n\", 6 ^ 10);\n  printf(\"shl %i\\n\", 3 << 2);\n  printf(\"shr %i\\n\", 96 >> 3);\n  printf(\"comma %i\\n\", (4, 12));\n}\n"
  },

  {
    title: "structures de contrôle",
    source: "#include <stdio.h>\nint main() {\n  int k;\n  if (1) {\n    printf(\"t\");\n  }\n  if (0) {\n    printf(\"F\");\n  } else {\n    printf(\"!f\");\n  }\n  for (k = 0; k < 3; k++) {\n    printf(\"%i\", k);\n  }\n  while (k < 5) {\n    printf(\"%i\", k);\n    ++k;\n  }\n  do {\n    printf(\"%i\", k);\n    k += 1;\n  } while (k < 7);\n}\n"
  },

  {
    title: "for, break, continue",
    source: "#include <stdio.h>\nint main() {\n  int i;\n  for (i = 0; i < 5; i++) {\n    printf(\"%i\\n\", i);\n    if (i == 1) { i += 1; continue; }\n    if (i == 3) break;\n  }\n  printf(\"valeur finale: %i\\n\", i);\n}\n"
  },

  {
    title: "opérateurs relationnels",
    source: "#include <stdio.h>\nint main() {\n  int a = 1, b = 2;\n  if (a == a) printf(\" a == a\\n\");\n  if (a != b) printf(\" a != b\\n\");\n  if (a < b) printf(\" a < b\\n\");\n  if (a <= a) printf(\" a <= a\\n\");\n  if (b > a) printf(\" b > a\\n\");\n  if (b >= b) printf(\" b >= b\\n\");\n}\n"
  },

  {
    title: "variables et pointeurs",
    source: "#include <stdio.h>\nint main() {\n  int i = 0, j = 1, *k = &j;\n  *k = 3;\n  printf(\"i = %i, j = %i\\n\", i, j);\n  {\n    int i = 1;\n    j = 2;\n    printf(\"i = %i, j = %i\\n\", i, j);\n  }\n  printf(\"i = %i, j = %i\\n\", i, j);\n}\n"
  },

  {
    title: "et/ou logique et post/pre increment",
    source: "#include <stdio.h>\nint main() {\n  int k = 0;\n  printf(\"%i\", k && k++);\n  printf(\"%i\", k || k++);\n  printf(\"%i\", k || k++);\n  printf(\"%i\", k && k++);\n}\n"
  },

  {
    title: "int, short, char",
    source: "#include <stdio.h>\nint main() {\n  char c = '*', d = 127;\n  unsigned char e = d + 1;\n  int i = c, j = 0x1002A;\n  short  s = j;\n  printf(\"%i %i %i %u\\n\", i, j, s, e);\n}\n"
  },

  {
    title: "tableau 1D",
    source: [
    "#include <stdio.h>",
    "int main() {",
    "    //! showArray(a, cursors=[i,n], n=8, cw=32)",
    "    int i, n = 12;",
    "    int a[n];",
    "    a[0] = 1;",
    "    for (i = 1; i < n; i++) {",
    "        a[i] = a[i - 1] * 2;",
    "    }",
    "    for (i = 0; i < n; i++) {",
    "        printf(\"a[%i] = %i\\n\", i, a[i]);",
    "    }",
    "}"].join('\n')
  },

  {
    title: "appel de fonction",
    source: [
      "#include <stdio.h>",
      "int fact(int n) {",
      "    if (n == 0)",
      "        return 1;",
      "    return n * fact(n - 1);",
      "}",
      "int main() {",
      "    int n = 12;",
      "    printf(\"%d! = %d\\n\", n, fact(n));",
      "}"
    ].join('\n')
  },

  {
    title: "entrée/sortie",
    source: [
      "#include <stdio.h>",
      "unsigned long strlen(const char * s) {",
      "  unsigned long l = 0;",
      "  while (*s++) ++l;",
      "  return l;",
      "}",
      "int main() {",
      "    int a, n;",
      "    char s[12];",
      "    printf(\"Entrez un mot et un nombre:\\n\");",
      "    n = scanf(\"%s %d\", s, &a);",
      "    if (n == 2) {",
      "        printf(\"Longueur du mot * nombre = %lu\\n\", strlen(s) * a);",
      "    } else {",
      "        printf(\"Pas de valeur!\\n\");",
      "    }",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "factorielle",
    source: "#include <stdio.h>\nint main (int argc, char** argv) {\n    //! showVar(b)\n    int b = 1;\n    for (int a = 1; a < 1000000; a += 1) {\n        b = b * a;\n        printf(\"%d\\n\", b);\n    }\n    return 1;\n}\n",
    selection: {start: {row: 2, column: 24}, end: {row: 2, column: 31}}
  },

  {
    title: "fibonacci",
    source: [
      "#include <stdio.h>",
      "int fibo(int n) {",
      "   if (n == 0)",
      "       return 0;",
      "   if (n == 1)",
      "       return 1;",
      "   int a = fibo(n - 1);",
      "   int b = fibo(n - 2);",
      "   return a + b;",
      "}",
      "int main() {",
      "     int n = 15;",
      "     printf(\"fibo(%d) = %d\\n\", n, fibo(n));",
      "}"
    ].join('\n')
  },

  {
    title: "listes d'initialisation",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "    int a[] = {1, 2};",
      "    int * b = a;",
      "    printf(\"%d %d\\n\", *b, b[1]);",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "types composés",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "",
      "    // array of pointer to int",
      "    int *a[1];",
      "    int a_value = 1;",
      "    a[0] = &a_value;",
      "",
      "    // declare b as pointer to array of int",
      "    int (*b)[];",
      "    int b_value[1];",
      "    b = &b_value;",
      "",
      "    // declare foo as array 3 of array 2 of pointer to pointer to function returning pointer to array of pointer to char",
      "    char *(*(**foo[3][2])())[];",
      "",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "variables globales",
    source: [
      "#include <stdio.h>",
      "int a = 1;",
      "int b = 2;",
      "int main() {",
      "    printf(\"&a = %p  &b = %p\\n\", &a, &b);",
      "    printf(\"a = %d\\n\", a);",
      "    a += 1;",
      "    printf(\"a = %d\\n\", a);",
      "}"
    ].join('\n')
  },

  {
    title: "init. tableau 2D global",
    source: [
      "#include <stdio.h>",
      "int a[][2] = {{1, 2}, {3, 4}};",
      "int main() {",
      "    printf(\"%d %d\\n\", a[0][0], a[0][1]);",
      "    printf(\"%d %d\\n\", a[1][0], a[1][1]);",
      "    printf(\"%d %d %d %d\\n\", **a, *(*a + 1), **(a + 1), *(*(a + 1) + 1));",
      "}"
    ].join('\n')
  },

  {
    title: "affichage de la mémoire",
    source: [
      "#include <stdio.h>",
      "void show(int i, int j) {",
      "    printf(\"i = %i, j = %i\\n\", i, j);",
      "}",
      "int main() {",
      "    //! showMemory(extras=[i,*p], cursors=[k,&a[j][i],p], start=65504, cursorRows=2)",
      "    int i = 0, j = 1, *k = &j;",
      "    int a[3][2] = {0,1,2,3};",
      "    char * p = ((char*)&a[1][1]) + 3;",
      "    *k = 2;",
      "    show(i, j);",
      "    {",
      "        int i = 1;",
      "        j = 2;",
      "        show(i, j);",
      "    }",
      "    show(i, j);",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "quicksort",
    source: [
      "#include <stdio.h>",
      "",
      "void print_array(int size, int array[]) {",
      "    for (int pos = 0; pos < size; pos += 1) {",
      "        printf(\"%d%s\", array[pos], pos + 1 == size ? \"\" : \" \");",
      "    }",
      "    printf(\"\\n\");",
      "}",
      "",
      "void quick_sort (int size, int array[], int left, int right) {",
      "    //! quicksort = showSort(array, cursors=[left, right, i, j], dim=size, thresholds=[pivot])",
      "    if (right <= left)",
      "        return;",
      "    int pivot = array[right];",
      "    int i = left;",
      "    int j = right;",
      "    while (1) {",
      "        while (array[i] < pivot)",
      "            i += 1;",
      "        while (pivot < array[j])",
      "            j -= 1;",
      "        if (i >= j) {",
      "            break;",
      "        }",
      "        int temp = array[i];",
      "        array[i] = array[j];",
      "        array[j] = temp;",
      "        i += 1;",
      "        j -= 1;",
      "    }",
      "    quick_sort(size, array, left, i - 1);",
      "    quick_sort(size, array, i, right);",
      "}",
      "",
      "int main() {",
      "    //! quicksort = showSort(array, dim=n)",
      "    int array[] = {4, 2, 1, 2, 3, 2, 1, 0, 1};",
      "    int n = sizeof array / sizeof *array;",
      "    quick_sort(n, array, 0, n - 1);",
      "    print_array(n, array);",
      "    return 0;",
      "}"
    ].join('\n')
  },

  {
    title: "multiplication de matrices",
    source: [
      "#include <stdio.h>",
      "int main() {",
      "    //! A = showArray2D(A, rowCursors=[i], colCursors=[k], width=.33)",
      "    //! B = showArray2D(B, rowCursors=[k], colCursors=[j], width=.33)",
      "    //! C = showArray2D(C, rowCursors=[i], colCursors=[j], width=.33)",
      "    double A[2][2] = {{0.866, -0.500}, {0.500, 0.866}};",
      "    double B[2][2] = {{0.500, -0.866}, {0.866, 0.500}};",
      "    double C[2][2];",
      "    for (int i = 0; i < 2; i++) {",
      "        for (int j = 0; j < 2; j++) {",
      "            C[i][j] = 0;",
      "            for (int k = 0; k < 2; k++) {",
      "                C[i][j] += A[i][k] * B[k][j];",
      "            }",
      "        }",
      "    }",
      "    for (int i = 0; i < 2; i++) {",
      "        for (int j = 0; j < 2; j++) {",
      "            printf(\"%.3f \", C[i][j]);",
      "        }",
      "        printf(\"\\n\");",
      "    }",
      "    return 0;",
      "}"
    ].join('\n')
  }

  // TODO: add example for a?b:c

];

const startOfBuffer = {start: {row: 0, column: 0}, end: {row: 0, column: 0}};

export default function (bundle, deps) {

  bundle.use('bufferReset', 'ioPaneModeChanged');

  bundle.defineAction('exampleSelected', 'Example.Selected');

  bundle.addReducer('init', state => state.set('examples', examples));

  bundle.defineSelector('getExamples', function (state) {
    return state.getIn(['examples']);
  });

  function* loadExample (example) {
    const sourceModel = Immutable.Map({
      document: documentFromString(example.source),
      selection: example.selection || startOfBuffer,
      firstVisibleRow: example.firstVisibleRow || 0
    });
    yield put({type: deps.bufferReset, buffer: 'source', model: sourceModel});
    const inputModel = Immutable.Map({
      document: documentFromString(example.input || ""),
      selection: startOfBuffer,
      firstVisibleRow: 0
    });
    yield put({type: deps.bufferReset, buffer: 'input', model: inputModel});
    /* Force split mode if the example has an associated input. */
    if (example.input) {
      yield put({type: deps.ioPaneModeChanged, mode: 'split'});
    }
  }

  bundle.addSaga(function* watchExampleSelected () {
    while (true) {
      let {example} = yield take(deps.exampleSelected);
      if (typeof example === 'number') {
        let examples = yield select(deps.getExamples);
        example = examples[example];
      }
      yield call(loadExample, example);
    }
  });

  function ExamplePickerSelector (state, props) {
    let examples = deps.getExamples(state);
    const mode = state.get('mode');
    examples = examples.filter(ex => ex.mode === mode);
    return {examples};
  }

  bundle.defineView('ExamplePicker', ExamplePickerSelector, class ExamplePicker extends React.PureComponent {

    render () {
      const {examples, disabled} = this.props;
      const exampleOptions = examples.map((example) =>
        ({label: example.title, value: example}));
      return <Select options={exampleOptions} onChange={this.onSelect} clearableValue={false} />;
    }

    onSelect = (option) => {
      this.props.onSelect(option.value);
    };

  });

};
