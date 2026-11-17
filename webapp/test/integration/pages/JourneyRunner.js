sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"arledesmafioritm/confviajereporte/test/integration/pages/ConformidadViajeList.gen",
	"arledesmafioritm/confviajereporte/test/integration/pages/ConformidadViajeObjectPage.gen"
], function (JourneyRunner, ConformidadViajeListGenerated, ConformidadViajeObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('arledesmafioritm/confviajereporte') + '/test/flp.html#app-preview',
        pages: {
			onTheConformidadViajeListGenerated: ConformidadViajeListGenerated,
			onTheConformidadViajeObjectPageGenerated: ConformidadViajeObjectPageGenerated
        },
        async: true
    });

    return runner;
});

