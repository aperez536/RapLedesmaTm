sap.ui.define(
    ["sap/fe/core/AppComponent"],
    function (Component) {
        "use strict";

        var REQUIRED_ROLE = "ZTM_CONFVIAJE_VISU";
        var OVERLAY_ID = "confViajeAuthOverlay";

        return Component.extend("arledesmafioritm.confviajereporte.Component", {
            metadata: {
                manifest: "json"
            },

            init: function () {
                // Tapa la pantalla mientras se valida el acceso.
                // Si el usuario no tiene el rol, queda en blanco.
                var oOverlay = document.getElementById(OVERLAY_ID);
                if (!oOverlay) {
                    oOverlay = document.createElement("div");
                    oOverlay.id = OVERLAY_ID;
                    oOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;z-index:99998";
                    document.body.appendChild(oOverlay);
                }

                Component.prototype.init.apply(this, arguments);

                this._checkAccess().then(function (bAuthorized) {
                    if (bAuthorized) {
                        if (oOverlay.parentNode) {
                            oOverlay.parentNode.removeChild(oOverlay);
                        }
                    } else {
                        this._showAccessDenied();
                    }
                }.bind(this));
            },

            /**
             * La ruta /sap del xs-app.json exige el scope ZTM_CONFVIAJE_VISU.
             * Sin el rol, el approuter responde 401/403 al $metadata.
             */
            _checkAccess: function () {
                var sHost = (window.location && window.location.hostname) || "";
                if (sHost === "localhost" || sHost === "127.0.0.1") {
                    return Promise.resolve(true);
                }

                var oModel = this.getModel();
                if (!oModel) {
                    return Promise.resolve(false);
                }

                return oModel.getMetaModel().requestObject("/").then(function () {
                    return true;
                }, function (oError) {
                    var iStatus = oError && oError.status;
                    return !(iStatus === 401 || iStatus === 403);
                });
            },

            /**
             * El mensaje se dibuja dentro del overlay y no con un MessageBox:
             * los popups de UI5 usan z-index ~1000 y quedarian ocultos detras
             * del overlay (z-index 99998), dejando la pantalla en blanco.
             */
            _showAccessDenied: function () {
                var oBundle = this.getModel("i18n").getResourceBundle();
                var oOverlay = document.getElementById(OVERLAY_ID);
                if (!oOverlay) {
                    oOverlay = document.createElement("div");
                    oOverlay.id = OVERLAY_ID;
                    oOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;z-index:99998";
                    document.body.appendChild(oOverlay);
                }
                oOverlay.style.display = "flex";
                oOverlay.style.alignItems = "center";
                oOverlay.style.justifyContent = "center";
                oOverlay.style.fontFamily = "'72', Arial, sans-serif";

                var oBox = document.createElement("div");
                oBox.style.cssText = "max-width:480px;margin:1rem;padding:2rem;border:1px solid #e5e5e5;border-radius:12px;" +
                    "box-shadow:0 4px 16px rgba(0,0,0,.12);text-align:center;color:#32363a;background:#fff";

                var oTitle = document.createElement("h2");
                oTitle.style.cssText = "margin:0 0 1rem;color:#bb0000;font-size:1.25rem";
                oTitle.textContent = oBundle.getText("msgAccessDeniedTitle");

                var oText = document.createElement("p");
                oText.style.cssText = "margin:0;line-height:1.5";
                oText.textContent = oBundle.getText("msgAccessDenied", [REQUIRED_ROLE]);

                oBox.appendChild(oTitle);
                oBox.appendChild(oText);
                oOverlay.innerHTML = "";
                oOverlay.appendChild(oBox);
            }
        });
    }
);
