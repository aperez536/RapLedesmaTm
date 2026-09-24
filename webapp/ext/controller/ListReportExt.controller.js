sap.ui.define([
  "sap/ui/core/mvc/ControllerExtension",
  "sap/ui/export/Spreadsheet",
  "sap/ui/export/library",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageStrip",
  "sap/m/MessageBox"
], function (ControllerExtension, Spreadsheet, exportLibrary, MessageToast, BusyIndicator, MessageStrip, MessageBox) {
  "use strict";

  var EdmType = exportLibrary.EdmType;

  // Cantidad de filas por request al leer todo el reporte
  var PAGE_SIZE = 500;
  // Tope de filas para los campos que se leen en un solo request
  var MAX_ROWS = 100000;
  // Separador para los campos con varios valores dentro de un mismo documento
  var MULTI_VALUE_SEPARATOR = " | ";
  // Campos decimales que pueden provocar dump en el backend si el valor
  // excede la precisión declarada (ej. PesoBruto del documento 6100001172)
  var DECIMAL_FIELDS = ["PesoBruto", "DistanciaTotal", "UtilizacionMaxima"];

  return ControllerExtension.extend("fiori.tm.confviaje.reporte.ext.controller.ListReportExt", {

    override: {
      onInit: function () {
        this._attachTotalsListener();
      }
    },

    // ============================================================
    // SUMATORIA DE TOTALES (PesoBruto + DistanciaTotal)
    // ============================================================

    _attachTotalsListener: function () {
      var oTable = this._findTable();
      if (!oTable) {
        // La tabla puede no estar lista todavía; reintentar en breve
        setTimeout(this._attachTotalsListener.bind(this), 500);
        return;
      }
      // Se escucha el evento de la tabla y no el del binding, porque FE crea
      // un binding nuevo en cada búsqueda y el listener se perdería
      if (oTable.isA("sap.ui.table.Table")) {
        oTable.attachRowsUpdated(this._calculateTotals, this);
      } else {
        oTable.attachUpdateFinished(this._calculateTotals, this);
      }
      this._calculateTotals(); // Cálculo inicial si la tabla ya tiene datos
    },

    _calculateTotals: function () {
      var oTable = this._findTable();
      if (!oTable || !(oTable.getBinding("rows") || oTable.getBinding("items"))) {
        return; // Todavía no se ejecutó la búsqueda
      }

      this._requestBaseQuery().then(function (oBase) {
        // El evento se dispara también al hacer scroll; si los filtros no
        // cambiaron, los totales tampoco, así que no se vuelve a leer todo
        var sKey = oBase.params.filter(function (sParam) {
          return this._paramName(sParam) !== "$orderby";
        }.bind(this)).join("&");
        if (sKey === this._sTotalsKey) {
          return;
        }
        this._sTotalsKey = sKey;

        return this._fetchAll(oBase, ["PesoBruto", "DistanciaTotal"]).then(function (oResult) {
          var fPesoTotal = 0;
          var fDistanciaTotal = 0;

          oResult.rows.forEach(function (oData) {
            fPesoTotal += parseFloat(oData.PesoBruto) || 0;
            fDistanciaTotal += parseFloat(oData.DistanciaTotal) || 0;
          });

          this._showTotals(fPesoTotal, fDistanciaTotal, oResult.problems);
        }.bind(this));
      }.bind(this)).catch(function (oError) {
        this._sTotalsKey = null;
        // Si falla el cálculo de totales, no interrumpe el resto de la app
        MessageToast.show("No se pudo calcular el total: " + (oError.message || oError));
      }.bind(this));
    },

    _showTotals: function (fPesoTotal, fDistanciaTotal, aProblems) {
      var sText = "Peso bruto total: " + fPesoTotal.toLocaleString("es-AR", { maximumFractionDigits: 3 }) +
                  " kg — Distancia total: " + fDistanciaTotal.toLocaleString("es-AR", { maximumFractionDigits: 3 }) + " km";
      if (aProblems && aProblems.length) {
        sText += " (no incluye valores ilegibles de: " + this._describeProblems(aProblems) + ")";
      }

      var oView = this.base.getView();
      var sStripId = oView.getId() + "--totalsMessageStrip";
      var oExistingStrip = sap.ui.getCore().byId(sStripId);

      if (oExistingStrip) {
        oExistingStrip.setText(sText);
        return;
      }

      var oStrip = new MessageStrip(sStripId, {
        text: sText,
        type: "Information",
        showIcon: true
      });

      if (!this._placeAboveTable(oStrip)) {
        oStrip.destroy();
        MessageToast.show(sText);
      }
    },

    /**
     * Inserta el control justo encima de la tabla. La tabla interna está
     * envuelta en controles de FE (sap.ui.mdc.Table, macros) que no admiten
     * hijos, así que se sube por los padres hasta el primero con una
     * agregación múltiple ("items" o "content") y se inserta antes de la rama
     * que contiene la tabla. Si no hay ninguno, va en la cabecera de la página.
     */
    _placeAboveTable: function (oControl) {
      var oChild = this._findTable();
      var oParent = oChild && oChild.getParent();

      while (oParent) {
        var aNames = ["items", "content"];
        for (var i = 0; i < aNames.length; i++) {
          var oAggregation = oParent.getMetadata().getAggregation(aNames[i]);
          var iIndex = oAggregation && oAggregation.multiple ? oParent.indexOfAggregation(aNames[i], oChild) : -1;
          if (iIndex >= 0) {
            oParent.insertAggregation(aNames[i], oControl, iIndex);
            return true;
          }
        }
        if (oParent.isA("sap.f.DynamicPage") && oParent.getHeader()) {
          oParent.getHeader().addContent(oControl);
          return true;
        }
        oChild = oParent;
        oParent = oParent.getParent();
      }
      return false;
    },

    // ============================================================
    // EXPORTACIÓN COMPLETA (todas las columnas, sin importar
    // cuáles estén visibles en pantalla)
    // ============================================================

    onExportFull: function () {
      BusyIndicator.show(0);

      this._requestBaseQuery().then(function (oBase) {
        return this._fetchAll(oBase, this._getAllFieldNames());
      }.bind(this)).then(function (oResult) {
        BusyIndicator.hide();
        this._downloadExcel(oResult.rows);
        if (oResult.problems.length) {
          MessageBox.warning(
            "El backend no pudo devolver algunos valores y quedaron vacíos en el Excel:\n\n" +
            this._describeProblems(oResult.problems) +
            "\n\nRevisar esos documentos en el sistema (dump RAISE_SHORTDUMP en ST22)."
          );
        }
      }.bind(this)).catch(function (oError) {
        BusyIndicator.hide();
        MessageToast.show("Error al exportar: " + (oError.message || oError));
      });
    },

    // ============================================================
    // LECTURA PAGINADA DEL BACKEND
    // Se lee con fetch directo (no con el ODataModel) para poder
    // aislar las filas que provocan dump sin abortar toda la lectura.
    // ============================================================

    /**
     * Lee todas las filas que coinciden con los filtros/orden actuales de la tabla.
     * Devuelve { rows: [...], problems: [{ TorId, fields: [...] }] }.
     *
     * El backend repite un documento por cada parada/evento cuando se piden
     * esos campos, así que $count y $skip no sirven para paginar el set
     * completo. Por eso:
     *  - los campos no decimales se leen en un solo request (no provocan dump);
     *  - los decimales (una fila por documento) se leen paginados aislando
     *    la fila que provoca dump, y se unen por TorId.
     */
    _fetchAll: function (oBase, aFields) {
      var aDecimals = aFields.filter(function (sField) { return DECIMAL_FIELDS.indexOf(sField) >= 0; });
      var aOthers = aFields.filter(function (sField) { return DECIMAL_FIELDS.indexOf(sField) < 0; });
      var aProblems = [];

      var pDecimals = aDecimals.length ? this._fetchPaged(oBase, ["TorId"].concat(aDecimals), aProblems) : Promise.resolve([]);
      if (!aOthers.length) {
        return pDecimals.then(function (aRows) {
          return { rows: aRows, problems: aProblems };
        });
      }

      if (aOthers.indexOf("TorId") < 0) {
        aOthers.push("TorId");
      }
      var pOthers = this._fetchRows(oBase, aOthers, 0, MAX_ROWS);

      return Promise.all([pOthers, pDecimals]).then(function (aResults) {
        var mDecimalsByTorId = {};
        aResults[1].forEach(function (oRow) { mDecimalsByTorId[oRow.TorId] = oRow; });

        var aRows = this._consolidateByTorId(aResults[0], aOthers).map(function (oRow) {
          var oDecimals = mDecimalsByTorId[oRow.TorId] || {};
          aDecimals.forEach(function (sField) { oRow[sField] = oDecimals[sField]; });
          return oRow;
        });
        return { rows: aRows, problems: aProblems };
      }.bind(this));
    },

    /**
     * Deja una fila por documento, igual que el contador de la tabla. Los
     * campos con varios valores (paradas, eventos, vehículos) se unen con " | ".
     */
    _consolidateByTorId: function (aRows, aFields) {
      var mByTorId = {};
      var aResult = [];

      aRows.forEach(function (oRow) {
        var oTarget = mByTorId[oRow.TorId];
        if (!oTarget) {
          oTarget = mByTorId[oRow.TorId] = { values: {} };
          aFields.forEach(function (sField) { oTarget.values[sField] = []; });
          aResult.push(oTarget);
        }
        aFields.forEach(function (sField) {
          var vValue = oRow[sField];
          if (vValue !== null && vValue !== undefined && vValue !== "" &&
              oTarget.values[sField].indexOf(vValue) < 0) {
            oTarget.values[sField].push(vValue);
          }
        });
      });

      return aResult.map(function (oTarget) {
        var oRow = {};
        aFields.forEach(function (sField) {
          var aValues = oTarget.values[sField];
          oRow[sField] = aValues.length > 1 ? aValues.join(MULTI_VALUE_SEPARATOR) : aValues[0];
        });
        return oRow;
      });
    },

    /**
     * Lee por páginas hasta recibir una página incompleta.
     * Solo para selects que devuelven una fila por documento.
     */
    _fetchPaged: function (oBase, aFields, aProblems) {
      var aRows = [];
      var fnNextPage = function (iSkip) {
        return this._fetchRange(oBase, aFields, iSkip, PAGE_SIZE, aProblems).then(function (aPage) {
          aRows = aRows.concat(aPage);
          return aPage.length < PAGE_SIZE ? aRows : fnNextPage(iSkip + PAGE_SIZE);
        });
      }.bind(this);
      return fnNextPage(0);
    },

    /**
     * Toma la URL de la tabla (con $filter, $search, $orderby del usuario)
     * y quita las opciones que se arman acá por cada página.
     */
    _requestBaseQuery: function () {
      var oTable = this._findTable();
      var oBinding = oTable && (oTable.getBinding("rows") || oTable.getBinding("items"));
      if (!oBinding) {
        return Promise.reject(new Error("No se pudo obtener el binding de la tabla."));
      }

      var pUrl = oBinding.requestDownloadUrl ? oBinding.requestDownloadUrl() : Promise.resolve(oBinding.getDownloadUrl());
      return pUrl.then(function (sUrl) {
        var iQuery = sUrl.indexOf("?");
        var sPath = iQuery < 0 ? sUrl : sUrl.slice(0, iQuery);
        var aParams = iQuery < 0 ? [] : sUrl.slice(iQuery + 1).split("&").filter(function (sParam) {
          return ["$select", "$expand", "$top", "$skip", "$count"].indexOf(this._paramName(sParam)) < 0;
        }.bind(this));

        // Orden estable para que la paginación no repita ni saltee filas
        var iOrderBy = aParams.findIndex(function (sParam) { return this._paramName(sParam) === "$orderby"; }.bind(this));
        if (iOrderBy < 0) {
          aParams.push("$orderby=TorId");
        } else if (decodeURIComponent(aParams[iOrderBy]).indexOf("TorId") < 0) {
          aParams[iOrderBy] += encodeURIComponent(",TorId");
        }

        return { path: sPath, params: aParams };
      }.bind(this));
    },

    _paramName: function (sParam) {
      return decodeURIComponent(sParam.split("=")[0]);
    },

    _request: function (oBase, aExtraParams) {
      var sUrl = oBase.path + "?" + oBase.params.concat(aExtraParams).join("&");
      return fetch(sUrl, { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (oResponse) {
          if (!oResponse.ok) {
            var oError = new Error("HTTP " + oResponse.status + " al leer " + oBase.path);
            oError.status = oResponse.status;
            throw oError;
          }
          return oResponse.json();
        });
    },

    _fetchRows: function (oBase, aFields, iSkip, iTop) {
      return this._request(oBase, ["$select=" + aFields.join(","), "$skip=" + iSkip, "$top=" + iTop])
        .then(function (oData) { return oData.value; });
    },

    /**
     * Lee un rango de filas. Si el backend responde 500 (dump), divide el
     * rango a la mitad hasta aislar la fila culpable.
     */
    _fetchRange: function (oBase, aFields, iSkip, iTop, aProblems) {
      return this._fetchRows(oBase, aFields, iSkip, iTop).catch(function (oError) {
        if (oError.status !== 500) {
          throw oError;
        }
        if (iTop === 1) {
          return this._fetchBrokenRow(oBase, aFields, iSkip, aProblems);
        }
        var iHalf = Math.ceil(iTop / 2);
        return this._fetchRange(oBase, aFields, iSkip, iHalf, aProblems).then(function (aFirst) {
          return this._fetchRange(oBase, aFields, iSkip + iHalf, iTop - iHalf, aProblems).then(function (aSecond) {
            return aFirst.concat(aSecond);
          });
        }.bind(this));
      }.bind(this));
    },

    /**
     * Lee una fila que provoca dump: primero sin los campos decimales y luego
     * cada decimal por separado, dejando vacíos los que sigan fallando.
     */
    _fetchBrokenRow: function (oBase, aFields, iSkip, aProblems) {
      var aDecimals = aFields.filter(function (sField) { return DECIMAL_FIELDS.indexOf(sField) >= 0; });
      var aSafe = aFields.filter(function (sField) { return DECIMAL_FIELDS.indexOf(sField) < 0; });
      if (aSafe.indexOf("TorId") < 0) {
        aSafe.push("TorId");
      }

      return this._fetchRows(oBase, aSafe, iSkip, 1).then(function (aRows) {
        var oRow = aRows[0] || {};
        var aMissing = [];

        return Promise.all(aDecimals.map(function (sField) {
          return this._fetchRows(oBase, [sField], iSkip, 1).then(function (aValue) {
            oRow[sField] = aValue[0] && aValue[0][sField];
          }).catch(function () {
            aMissing.push(sField);
          });
        }.bind(this))).then(function () {
          if (aMissing.length) {
            aProblems.push({ TorId: oRow.TorId, fields: aMissing });
          }
          return [oRow];
        });
      }.bind(this));
    },

    _describeProblems: function (aProblems) {
      return aProblems.map(function (oProblem) {
        return oProblem.TorId + " (" + oProblem.fields.join(", ") + ")";
      }).join("; ");
    },

    // ============================================================
    // HELPERS
    // ============================================================

    _findTable: function () {
      var oView = this.base.getView();
      var aTables = oView.findAggregatedObjects(true, function (oControl) {
        return oControl.isA("sap.ui.table.Table") || oControl.isA("sap.m.Table");
      });
      return aTables && aTables.length > 0 ? aTables[0] : null;
    },

    _getAllFieldNames: function () {
      return [
        "TorId", "CreatedOnDate", "CreatedOnTime", "TorType", "Tspid",
        "TransportistaNombre", "Consigneeid", "DestinoNombre",
        "UbicacionOrigen", "DescripcionOrigen", "OrigenCalle", "OrigenCiudad", "OrigenCodPostal",
        "UbicacionDestino", "DescripcionDestino", "DestinoCalle", "DestinoCiudad", "DestinoCodPostal",
        "Conductor", "DistanciaTotal", "DistanciaUnidad", "MedioTransporte",
        "RecursoVehiculo", "NumeroMatricula", "PesoBruto", "UmPesoBruto", "UtilizacionMaxima",
        "StatusCicloVida", "StatusCicloVidaText", "StatusEjecucion", "StatusEjecucionText",
        "OrganizacionCompras", "StatusCalcCst", "StatusCalcCstText",
        "EstadoFacturacion", "EstadoFacturacionText",
        "CreatedBy", "ChangedBy", "ChangedOnDate", "ChangedOnTime",
        "MotivoEvento", "FechaHoraEventoDate", "FechaHoraEventoTime", "CodigoEvento",
        "FechaCalculoDate", "FechaCalculoTime", "FechaCalculoModifManual"
      ];
    },

    _downloadExcel: function (aData) {
      var aColumns = [
        { label: "Documento", property: "TorId", type: EdmType.String },
        { label: "Fecha creación", property: "CreatedOnDate", type: EdmType.Date },
        { label: "Hora creación", property: "CreatedOnTime", type: EdmType.String },
        { label: "Clase de documento", property: "TorType", type: EdmType.String },
        { label: "Transportista", property: "Tspid", type: EdmType.String },
        { label: "Nombre transportista", property: "TransportistaNombre", type: EdmType.String },
        { label: "Destinatario", property: "Consigneeid", type: EdmType.String },
        { label: "Nombre destinatario", property: "DestinoNombre", type: EdmType.String },
        { label: "Ubicación origen", property: "UbicacionOrigen", type: EdmType.String },
        { label: "Descripción origen", property: "DescripcionOrigen", type: EdmType.String },
        { label: "Calle origen", property: "OrigenCalle", type: EdmType.String },
        { label: "Ciudad origen", property: "OrigenCiudad", type: EdmType.String },
        { label: "Cod. postal origen", property: "OrigenCodPostal", type: EdmType.String },
        { label: "Ubicación destino", property: "UbicacionDestino", type: EdmType.String },
        { label: "Descripción destino", property: "DescripcionDestino", type: EdmType.String },
        { label: "Calle destino", property: "DestinoCalle", type: EdmType.String },
        { label: "Ciudad destino", property: "DestinoCiudad", type: EdmType.String },
        { label: "Cod. postal destino", property: "DestinoCodPostal", type: EdmType.String },
        { label: "Conductor", property: "Conductor", type: EdmType.String },
        { label: "Distancia total", property: "DistanciaTotal", type: EdmType.Number },
        { label: "Unidad distancia", property: "DistanciaUnidad", type: EdmType.String },
        { label: "Medio de transporte", property: "MedioTransporte", type: EdmType.String },
        { label: "Recurso vehículo", property: "RecursoVehiculo", type: EdmType.String },
        { label: "Número matrícula", property: "NumeroMatricula", type: EdmType.String },
        { label: "Peso bruto", property: "PesoBruto", type: EdmType.Number },
        { label: "UM peso bruto", property: "UmPesoBruto", type: EdmType.String },
        { label: "Utilización máxima", property: "UtilizacionMaxima", type: EdmType.Number },
        { label: "Status ciclo de vida", property: "StatusCicloVidaText", type: EdmType.String },
        { label: "Status ejecución", property: "StatusEjecucionText", type: EdmType.String },
        { label: "Organización compras", property: "OrganizacionCompras", type: EdmType.String },
        { label: "Status cálc. costos", property: "StatusCalcCstText", type: EdmType.String },
        { label: "Estado facturación", property: "EstadoFacturacionText", type: EdmType.String },
        { label: "Creado por", property: "CreatedBy", type: EdmType.String },
        { label: "Modificado por", property: "ChangedBy", type: EdmType.String },
        { label: "Fecha modificación", property: "ChangedOnDate", type: EdmType.Date },
        { label: "Hora modificación", property: "ChangedOnTime", type: EdmType.String },
        { label: "Motivo evento", property: "MotivoEvento", type: EdmType.String },
        { label: "Fecha evento", property: "FechaHoraEventoDate", type: EdmType.Date },
        { label: "Hora evento", property: "FechaHoraEventoTime", type: EdmType.String },
        { label: "Código evento", property: "CodigoEvento", type: EdmType.String },
        { label: "Fecha cálculo", property: "FechaCalculoDate", type: EdmType.Date },
        { label: "Hora cálculo", property: "FechaCalculoTime", type: EdmType.String },
        { label: "Cálculo modif. manual", property: "FechaCalculoModifManual", type: EdmType.String }
      ];

      // Una celda con varios valores unidos no es una fecha válida para Excel
      aColumns.forEach(function (oColumn) {
        var bMultiValue = oColumn.type === EdmType.Date && aData.some(function (oRow) {
          return typeof oRow[oColumn.property] === "string" && oRow[oColumn.property].indexOf(MULTI_VALUE_SEPARATOR) >= 0;
        });
        if (bMultiValue) {
          oColumn.type = EdmType.String;
        }
      });

      var oSettings = {
        workbook: { columns: aColumns },
        dataSource: aData,
        fileName: "Conformidad_de_Viaje.xlsx"
      };

      new Spreadsheet(oSettings).build().finally(function () {
        MessageToast.show("Exportación completa finalizada.");
      });
    }

  });
});