sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"fiori/tm/confviaje/reporte/test/integration/pages/ConformidadViajeList.gen",
	"fiori/tm/confviaje/reporte/test/integration/pages/ConformidadViajeObjectPage.gen"
], function (JourneyRunner, ConformidadViajeListGenerated, ConformidadViajeObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('fiori/tm/confviaje/reporte') + '/test/flp.html#app-preview',
        pages: {
			onTheConformidadViajeListGenerated: ConformidadViajeListGenerated,
			onTheConformidadViajeObjectPageGenerated: ConformidadViajeObjectPageGenerated
        },
        async: true
    });

    return runner;
});

