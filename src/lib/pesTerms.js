// Catálogo de términos de Diagnóstico Nutricio (terminología eNCPT / PES) extraído del PDF
// que compartió la nutrióloga. Se usa en Diagnóstico → Dominios PES para seleccionar un término
// en lugar de escribirlo a mano. Cada término lleva su código TPAN (p.ej. NI-5.6.1).

export const PES_DOMAINS = [
  {
    "name": "INGESTIÓN",
    "code": "NI",
    "categories": [
      {
        "name": "Balance Energético",
        "code": "NI-1",
        "terms": [
          {
            "code": "NI-1.1",
            "anduid": "10633",
            "label": "Gasto energético incrementado"
          },
          {
            "code": "NI-1.2",
            "anduid": "10634",
            "label": "Ingestión energética inadecuada (subóptima)"
          },
          {
            "code": "NI-1.3",
            "anduid": "10635",
            "label": "Ingestión energética excesiva"
          },
          {
            "code": "NI-1.4",
            "anduid": "10636",
            "label": "Predicción de ingestión energética inadecuada (subóptima)"
          },
          {
            "code": "NI-1.5",
            "anduid": "10637",
            "label": "Predicción de ingestión energética excesiva"
          }
        ]
      },
      {
        "name": "Ingestión vía oral o apoyo nutricio",
        "code": "NI-2",
        "terms": [
          {
            "code": "NI-2.1",
            "anduid": "10639",
            "label": "Ingestió vía oral inadecuada (subóptima)"
          },
          {
            "code": "NI-2.2",
            "anduid": "10640",
            "label": "Ingestión vía oral excesiva"
          },
          {
            "code": "NI-2.3",
            "anduid": "10641",
            "label": "Infusión inadecuada (subóptima) de nutrición enteral"
          },
          {
            "code": "NI-2.4",
            "anduid": "10642",
            "label": "Infusión excesiva de nutrición enteral"
          },
          {
            "code": "NI-2.5",
            "anduid": "11142",
            "label": "Composición de nutrición enteral no acorde con los requerimientos"
          },
          {
            "code": "NI-2.6",
            "anduid": "11143",
            "label": "Administración de nutrición enteral no acorde con los requerimientos"
          },
          {
            "code": "NI-2.7",
            "anduid": "10644",
            "label": "Infusión inadecuada (subóptima) de nutrición parenteral"
          },
          {
            "code": "NI-2.8",
            "anduid": "10645",
            "label": "Infusión excesiva de nutrición parenteral"
          },
          {
            "code": "NI-2.9",
            "anduid": "11144",
            "label": "Composición de nutrición parenteral no acorde con los requerimientos"
          },
          {
            "code": "NI-2.10",
            "anduid": "11145",
            "label": "Administración de nutrición parenteral no acorde con los requerimientos"
          },
          {
            "code": "NI-2.11",
            "anduid": "10647",
            "label": "Aceptación limitada de alimentos"
          }
        ]
      },
      {
        "name": "Ingestión de líquidos",
        "code": "NI-3",
        "terms": [
          {
            "code": "NI-3.1",
            "anduid": "10649",
            "label": "Ingestión inadecuada (subóptima) de líquidos"
          },
          {
            "code": "NI-3.2",
            "anduid": "10650",
            "label": "Ingestión excesiva de líquidos"
          }
        ]
      },
      {
        "name": "Sustancias bioactivas",
        "code": "NI-4",
        "terms": [
          {
            "code": "NI-4.1",
            "anduid": "10859",
            "label": "Ingestión inadecuada (subóptima) de sustancias bioactivas (especificar)"
          },
          {
            "code": "NI-4.1.1",
            "anduid": "11077",
            "label": "Ingestión inadecuada (subóptima) de ésteres de estanoles vegetales"
          },
          {
            "code": "NI-4.1.2",
            "anduid": "11078",
            "label": "Ingestión inadecuada (subóptima) de ésteres de esteroles vegetales"
          },
          {
            "code": "NI-4.1.3",
            "anduid": "11080",
            "label": "Ingestión inadecuada (subóptima) de proteína de soya"
          },
          {
            "code": "NI-4.1.4",
            "anduid": "11079",
            "label": "Ingestión inadecuada (subóptima) de psyllium"
          },
          {
            "code": "NI-4.1.5",
            "anduid": "11076",
            "label": "Ingestión inadecuada (subóptima) de β- glucanos"
          },
          {
            "code": "NI-4.2",
            "anduid": "10653",
            "label": "Ingestión excesiva de sustancias bioactivas (especificar)"
          },
          {
            "code": "NI-4.2.1",
            "anduid": "11084",
            "label": "Ingestión excesiva de ésteres de estanoles vegetales"
          },
          {
            "code": "NI-4.2.2",
            "anduid": "11085",
            "label": "Ingestión escesiva de ésteres de esteroles vegetales"
          },
          {
            "code": "NI-4.2.3",
            "anduid": "11087",
            "label": "Ingestión excesiva de proteína de soya"
          },
          {
            "code": "NI-4.2.4",
            "anduid": "11086",
            "label": "Ingestion excesiva de psyllium"
          },
          {
            "code": "NI-4.2.5",
            "anduid": "11081",
            "label": "Ingestión excesiva de β-glucanos"
          },
          {
            "code": "NI-4.2.6",
            "anduid": "11083",
            "label": "Ingestión excesiva de aditivos de alimentos"
          },
          {
            "code": "NI-4.2.7",
            "anduid": "11082",
            "label": "Ingestión excesiva de cafeína"
          },
          {
            "code": "NI-4.3",
            "anduid": "10654",
            "label": "Ingestión excesiva de alcohol"
          }
        ]
      },
      {
        "name": "Nutrimentos",
        "code": "NI-5",
        "terms": [
          {
            "code": "NI-5.1",
            "anduid": "10656",
            "label": "Requerimientos nutrimentales incrementados"
          },
          {
            "code": "NI-5.2",
            "anduid": "10658",
            "label": "Ingestión energético-proteica inadecuada (subóptima)"
          },
          {
            "code": "NI-5.3",
            "anduid": "10659",
            "label": "Requerimientos nutrimentales disminuidos"
          },
          {
            "code": "NI-5.4",
            "anduid": "10660",
            "label": "Desequilibrio de nutrimentos"
          }
        ]
      },
      {
        "name": "Lípidos y Colesterol",
        "code": "NI-5.5",
        "terms": [
          {
            "code": "NI-5.5.1",
            "anduid": "10662",
            "label": "Ingestión inadecuada (subóptima) de lípidos"
          },
          {
            "code": "NI-5.5.2",
            "anduid": "10663",
            "label": "Ingestión excesiva de lípidos"
          },
          {
            "code": "NI-5.5.3",
            "anduid": "10854",
            "label": "Ingestión de tipos de lípidos no acorde con los requerimientos (especificar)"
          }
        ]
      },
      {
        "name": "Proteína",
        "code": "NI-5.6",
        "terms": [
          {
            "code": "NI-5.6.1",
            "anduid": "10666",
            "label": "Ingestión inadecuada (subóptima) de proteína"
          },
          {
            "code": "NI-5.6.2",
            "anduid": "10667",
            "label": "Ingestión excesiva de proteína"
          },
          {
            "code": "NI-5.6.3",
            "anduid": "10855",
            "label": "Ingestión de tipos de proteínas no acorde con los requerimientos (especificar)"
          }
        ]
      },
      {
        "name": "Aminoácidos",
        "code": "NI-5.7",
        "terms": [
          {
            "code": "NI-5.7.1",
            "anduid": "12007",
            "label": "Ingestión de tipos de aminoácidos no acorde con los requerimientos (especificar)"
          }
        ]
      },
      {
        "name": "Hidratos de carbono y Fibra",
        "code": "NI-5.8",
        "terms": [
          {
            "code": "NI-5.8.1",
            "anduid": "10670",
            "label": "Ingestión inadecuada (subóptima) de hidratos de carbono"
          },
          {
            "code": "NI-5.8.2",
            "anduid": "10671",
            "label": "Ingestión excesiva de hidratos de carbono"
          },
          {
            "code": "NI-5.8.3",
            "anduid": "10856",
            "label": "Ingestión de tipos de hidatos de carbono no acorde con los requerimientos (especificar)"
          },
          {
            "code": "NI-5.8.4",
            "anduid": "10673",
            "label": "Ingestión inconsistente de hidratos de carbono"
          },
          {
            "code": "NI-5.8.5",
            "anduid": "10675",
            "label": "Ingestión inadecuada (subóptima) de fibra"
          },
          {
            "code": "NI-5.8.6",
            "anduid": "10676",
            "label": "Ingestión excesiva de fibra"
          }
        ]
      },
      {
        "name": "Vitaminas",
        "code": "NI-5.9",
        "terms": [
          {
            "code": "NI-5.9.1",
            "anduid": "10678",
            "label": "Ingestión inadecuada de vitaminas (especificar)"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10679",
            "label": "Ingestión inadecuada de vitaminas A",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10680",
            "label": "Ingestión inadecuada de vitaminas C",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10681",
            "label": "Ingestión inadecuada de vitaminas D",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10682",
            "label": "Ingestión inadecuada de vitaminas E",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10683",
            "label": "Ingestión inadecuada de vitaminas K",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10684",
            "label": "Ingestión inadecuada de vitaminas Tiamina",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10685",
            "label": "Ingestión inadecuada de vitaminas Riboflavina",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10686",
            "label": "Ingestión inadecuada de vitaminas Niacina",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10687",
            "label": "Ingestión inadecuada de vitaminas Folatos",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10688",
            "label": "Ingestión inadecuada de vitaminas B6",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10689",
            "label": "Ingestión inadecuada de vitaminas B12",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10690",
            "label": "Ingestión inadecuada de vitaminas Ácido pantoténico",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.1",
            "anduid": "10691",
            "label": "Ingestión inadecuada de vitaminas Biotina",
            "parent": "NI-5.9.1"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10693",
            "label": "Ingestión excesiva de vitaminas (especificar)"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10694",
            "label": "Ingestión excesiva de vitaminas A",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10695",
            "label": "Ingestión excesiva de vitaminas C",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10696",
            "label": "Ingestión excesiva de vitaminas D",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10697",
            "label": "Ingestión excesiva de vitaminas E",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10698",
            "label": "Ingestión excesiva de vitaminas K",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10699",
            "label": "Ingestión excesiva de vitaminas Tiamina",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10700",
            "label": "Ingestión excesiva de vitaminas Riboflavina",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10701",
            "label": "Ingestión excesiva de vitaminas Niacina",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10702",
            "label": "Ingestión excesiva de vitaminas Folatos",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10703",
            "label": "Ingestión excesiva de vitaminas B6",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10704",
            "label": "Ingestión excesiva de vitaminas B12",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10705",
            "label": "Ingestión excesiva de vitaminas Ácido pantoténico (12)  Terminología de Diagnóstico Nutricio Código TPAN ANDUID Código TPAN ANDUID 2 Nutrition Care Process Terminology (eNCPT), 2017 Edition. Copyright 2017 Academy of Nutrition and Dietetics.",
            "parent": "NI-5.9.2"
          },
          {
            "code": "NI-5.9.2",
            "anduid": "10706",
            "label": "Ingestión excesiva de vitaminas Biotina",
            "parent": "NI-5.9.2"
          }
        ]
      },
      {
        "name": "Minerales",
        "code": "NI-5.10",
        "terms": [
          {
            "code": "NI-5.10.1",
            "anduid": "10709",
            "label": "Ingestión inadecuada (subóptima) de minerales (especificar)"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10710",
            "label": "Ingestión inadecuada (subóptima) de minerales Calcio",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10711",
            "label": "Ingestión inadecuada (subóptima) de minerales Cloro",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10712",
            "label": "Ingestión inadecuada (subóptima) de minerales Hierro",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10713",
            "label": "Ingestión inadecuada (subóptima) de minerales Magnesio",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10714",
            "label": "Ingestión inadecuada (subóptima) de minerales Potasio",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10715",
            "label": "Ingestión inadecuada (subóptima) de minerales Fósforo",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10716",
            "label": "Ingestión inadecuada (subóptima) de minerales Sodio",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10717",
            "label": "Ingestión inadecuada (subóptima) de minerales Zinc",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10718",
            "label": "Ingestión inadecuada (subóptima) de minerales Sulfato",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10719",
            "label": "Ingestión inadecuada (subóptima) de minerales Fluoruro",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10720",
            "label": "Ingestión inadecuada (subóptima) de minerales Cobre",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10721",
            "label": "Ingestión inadecuada (subóptima) de minerales Yodo",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10722",
            "label": "Ingestión inadecuada (subóptima) de minerales Selenio",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10723",
            "label": "Ingestión inadecuada (subóptima) de minerales Manganeso",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10724",
            "label": "Ingestión inadecuada (subóptima) de minerales Cromo",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10725",
            "label": "Ingestión inadecuada (subóptima) de minerales Molibdeno",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10726",
            "label": "Ingestión inadecuada (subóptima) de minerales Boro",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.1",
            "anduid": "10727",
            "label": "Ingestión inadecuada (subóptima) de minerales Cobalto",
            "parent": "NI-5.10.1"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10729",
            "label": "Ingestión excesiva de minerales (especificar)"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10730",
            "label": "Ingestión excesiva de minerales Calcio",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10731",
            "label": "Ingestión excesiva de minerales Cloro",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10732",
            "label": "Ingestión excesiva de minerales Hierro",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10733",
            "label": "Ingestión excesiva de minerales Magnesio",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10734",
            "label": "Ingestión excesiva de minerales Potasio",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10735",
            "label": "Ingestión excesiva de minerales Fósforo",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10736",
            "label": "Ingestión excesiva de minerales Sodio",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10737",
            "label": "Ingestión excesiva de minerales Zinc",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10738",
            "label": "Ingestión excesiva de minerales Sulfato",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10739",
            "label": "Ingestión excesiva de minerales Fluoruro",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10740",
            "label": "Ingestión excesiva de minerales Cobre",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10741",
            "label": "Ingestión excesiva de minerales Yodo",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10742",
            "label": "Ingestión excesiva de minerales Selenio",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10743",
            "label": "Ingestión excesiva de minerales Manganeso",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10744",
            "label": "Ingestión excesiva de minerales Cromo",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10745",
            "label": "Ingestión excesiva de minerales Molibdeno",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10746",
            "label": "Ingestión excesiva de minerales Boro",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.10.2",
            "anduid": "10747",
            "label": "Ingestión excesiva de minerales Cobalto (18)  Multi-nutrimentos (5.11)",
            "parent": "NI-5.10.2"
          },
          {
            "code": "NI-5.11.1",
            "anduid": "10750",
            "label": "Predicción de ingestión inadecuada (subóptima) de nutrimentos (especificar)"
          },
          {
            "code": "NI-5.11.2",
            "anduid": "10751",
            "label": "Predicción de ingestión excesiva de nutrimentos"
          }
        ]
      }
    ]
  },
  {
    "name": "CLÍNICOS",
    "code": "NC",
    "categories": [
      {
        "name": "Funcional",
        "code": "NC-1",
        "terms": [
          {
            "code": "NC-1.1",
            "anduid": "10754",
            "label": "Dificultad para deglutir"
          },
          {
            "code": "NC-1.2",
            "anduid": "10755",
            "label": "Dificultad para morder/masticar (Dificultad masticatoria)"
          },
          {
            "code": "NC-1.3",
            "anduid": "10756",
            "label": "Dificultades relacionadas con la lactancia"
          },
          {
            "code": "NC-1.4",
            "anduid": "10757",
            "label": "Función gastrointestinal (GI) alterada"
          },
          {
            "code": "NC-1.5",
            "anduid": "11146",
            "label": "Predicción de dificultades relacionadas con la lactancia"
          }
        ]
      },
      {
        "name": "Bioquímicos",
        "code": "NC-2",
        "terms": [
          {
            "code": "NC-2.1",
            "anduid": "10759",
            "label": "Alteración en la utilización de nutrimentos"
          },
          {
            "code": "NC-2.2",
            "anduid": "10760",
            "label": "Valores de laboratorio relacionados con la nutrición alterados (especificar)"
          },
          {
            "code": "NC-2.3",
            "anduid": "10761",
            "label": "Interacción alimento-medicamento (especificar)"
          },
          {
            "code": "NC-2.4",
            "anduid": "10762",
            "label": "Predicción de interacción alimento-medicamento"
          }
        ]
      },
      {
        "name": "Peso",
        "code": "NC-3",
        "terms": [
          {
            "code": "NC-3.1",
            "anduid": "10764",
            "label": "Bajo peso"
          },
          {
            "code": "NC-3.2",
            "anduid": "10765",
            "label": "Pérdida de peso no intencional"
          },
          {
            "code": "NC-3.3",
            "anduid": "10766",
            "label": "Sobrepeso/obesidad"
          },
          {
            "code": "NC-3.3.1",
            "anduid": "10767",
            "label": "Sobrepeso, adulto o pediátrico"
          },
          {
            "code": "NC-3.3.2",
            "anduid": "10768",
            "label": "Obesidad, pediátrico"
          },
          {
            "code": "NC-3.3.3",
            "anduid": "10769",
            "label": "Obesidad, Clase I"
          },
          {
            "code": "NC-3.3.4",
            "anduid": "10818",
            "label": "Obesidad, Clase II"
          },
          {
            "code": "NC-3.3.5",
            "anduid": "10819",
            "label": "Obesidad, Clase III"
          },
          {
            "code": "NC-3.4",
            "anduid": "10770",
            "label": "Aumento de peso no intencional"
          },
          {
            "code": "NC-3.5",
            "anduid": "10802",
            "label": "Tasa de crecimiento por debajo de lo esperado"
          },
          {
            "code": "NC-3.6",
            "anduid": "10803",
            "label": "Tasa de crecimiento excesiva"
          }
        ]
      },
      {
        "name": "Desórdenes de malnutrición",
        "code": "NC-4",
        "terms": [
          {
            "code": "NC-4.1",
            "anduid": "10657",
            "label": "Malnutrición (desnutrición)"
          },
          {
            "code": "NC-4.1.1",
            "anduid": "11130",
            "label": "Malnutrición relacionada a inanición"
          },
          {
            "code": "NC-4.1.2",
            "anduid": "11131",
            "label": "Malnutrición relacionada a enfermedad o condición crónica"
          },
          {
            "code": "NC-4.1.3",
            "anduid": "11132",
            "label": "Malnutrición relacionada a enfermedad aguda o lesión"
          },
          {
            "code": "NC-4.1.4",
            "anduid": "13017",
            "label": "Malnutrición pediátrica no relacionada a enfermedad"
          },
          {
            "code": "NC-4.1.5",
            "anduid": "13018",
            "label": "Malnutrición pediátrica relacionada a enfermedad"
          }
        ]
      }
    ]
  },
  {
    "name": "CONDUCTUAL-AMBIENTAL",
    "code": "NB",
    "categories": [
      {
        "name": "Conocimiento y Creencias",
        "code": "NB-1",
        "terms": [
          {
            "code": "NB-1.1",
            "anduid": "10773",
            "label": "Déficit de conocimientos relacionados con alimentos y nutrición"
          },
          {
            "code": "NB-1.2",
            "anduid": "10857",
            "label": "Creencias/actitudes infundadas sobre alimentos y temas relacionados con la nutrición"
          },
          {
            "code": "NB-1.3",
            "anduid": "10775",
            "label": "No estar preparado para cambios en la dieta/estilo de vida"
          },
          {
            "code": "NB-1.4",
            "anduid": "10776",
            "label": "Déficit en el automonitoreo"
          },
          {
            "code": "NB-1.5",
            "anduid": "10777",
            "label": "Patrón de alimentación desordenado"
          },
          {
            "code": "NB-1.6",
            "anduid": "10778",
            "label": "Apego limitado a las recomendaciones relacionadas con la nutrición"
          },
          {
            "code": "NB-1.7",
            "anduid": "10779",
            "label": "Elecciones no deseables de alimentos"
          }
        ]
      },
      {
        "name": "Actividad Física y Funcionalidad",
        "code": "NB-2",
        "terms": [
          {
            "code": "NB-2.1",
            "anduid": "10782",
            "label": "Inactividad física"
          },
          {
            "code": "NB-2.2",
            "anduid": "10783",
            "label": "Actividad física excesiva"
          },
          {
            "code": "NB-2.3",
            "anduid": "10780",
            "label": "Incapacidad para el autocuidado"
          },
          {
            "code": "NB-2.4",
            "anduid": "10785",
            "label": "Incapacidad para preparar alimentos/comidas"
          },
          {
            "code": "NB-2.5",
            "anduid": "10786",
            "label": "Precaria calidad de vida nutricia"
          },
          {
            "code": "NB-2.6",
            "anduid": "10787",
            "label": "Dificultad para autoalimentarse"
          }
        ]
      },
      {
        "name": "Seguridad Alimentaria y Acceso",
        "code": "NB-3",
        "terms": [
          {
            "code": "NB-3.1",
            "anduid": "10789",
            "label": "Ingestión de alimentos no seguros"
          },
          {
            "code": "NB-3.2",
            "anduid": "12009",
            "label": "Acceso limitado a alimentos"
          },
          {
            "code": "NB-3.3",
            "anduid": "10791",
            "label": "Acceso limitado a suministros relacionados con la nutrición"
          },
          {
            "code": "NB-3.4",
            "anduid": "12010",
            "label": "Acceso limitado a agua potable"
          }
        ]
      },
      {
        "name": "Otros",
        "code": "NB-1",
        "terms": [
          {
            "code": "",
            "anduid": "10795",
            "label": "Sin diagnóstico nutricio en este momento NO-1.1"
          }
        ]
      }
    ]
  }
]

// Mapea el título del dominio de la app al dominio PES por su prefijo de código.
export const PES_PREFIX_BY_DOMAIN = { 'INGESTIÓN': 'NI', 'CLÍNICOS': 'NC', 'CONDUCTUAL-AMBIENTAL': 'NB', 'CONDUCTUALES-AMBIENTALES': 'NB' }

export function pesDomainFor(domainTitle) {
  const prefix = PES_PREFIX_BY_DOMAIN[domainTitle]
  return PES_DOMAINS.find((domain) => domain.code === prefix) || null
}

// Términos del dominio (aplanados) para el selector; incluye su categoría.
export function pesTermsFor(domainTitle) {
  const domain = pesDomainFor(domainTitle)
  if (!domain) return []
  return domain.categories.flatMap((category) => category.terms.map((term) => ({ ...term, category: category.name })))
}

// Búsqueda insensible a mayúsculas/acentos por etiqueta o código, en todos los dominios.
export function searchPesTerms(query) {
  const q = String(query || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!q) return []
  const out = []
  for (const domain of PES_DOMAINS) {
    for (const category of domain.categories) {
      for (const term of category.terms) {
        const hay = (term.label + ' ' + term.code).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        if (hay.includes(q)) out.push({ ...term, domain: domain.name, domainCode: domain.code, category: category.name })
      }
    }
  }
  return out.slice(0, 60)
}

// Categorías ("apartados") de un dominio, cada una con sus términos: así la interfaz puede
// mostrar primero el título y desplegar sus hijos.
export function pesCategoriesFor(domainTitle) {
  const domain = pesDomainFor(domainTitle)
  return domain ? domain.categories : []
}
