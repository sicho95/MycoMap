# MycoMap

MycoMap est une PWA mobile-first pour repérer les zones naturellement favorables aux champignons et construire une mémoire privée de terrain.

## V1

- carte plein écran MapLibre, pensée pour iPhone et usage à une main ;
- fond cartographique **Plan IGN** ;
- potentiel en couleurs : bleu → vert → jaune → orange → rouge (point chaud) ;
- moteurs distincts pour **cèpes**, **girolles** et **morilles** ;
- **IGN BD Forêt v2** en WFS : polygones réels, code TFV, formation végétale et essence lorsqu'elle est fournie ;
- **IGN RGE ALTI** : altitude et calcul local de pente/exposition à partir de cinq échantillons autour de chaque zone ;
- météo réelle : pluies 3/7/14/30 jours, température et humidité du sol ;
- **SoilGrids 2.0 / ISRIC (250 m)** : pH, sable, limon, argile, fragments grossiers, capacité au champ et point de flétrissement ;
- classe de texture et indice de drainage calculés à partir des propriétés physiques du sol ;
- couche nationale **INRAE / GIS Sol** conservée en surimpression cartographique ;
- ajout d'une sortie positive ou négative ;
- une sortie négative ne dégrade réellement le modèle que si les conditions étaient favorables et l'effort de prospection significatif ;
- import d'une photo avec récupération de la position GPS EXIF et de la date ;
- historique privé stocké localement sur l'appareil ;
- PWA installable, thème clair/sombre/automatique ;
- mise à jour PWA automatique : contrôle périodique, reprise au premier plan et application immédiate du nouveau service worker.

## Principe du score

Le score affiché combine :

1. **forêt** : type de formation et essence de la BD Forêt v2, pondérés différemment selon l'espèce recherchée ;
2. **sol** : pH + texture + drainage physique estimé depuis SoilGrids ;
3. **terrain** : altitude, pente et exposition calculées depuis le RGE ALTI ;
4. **moment** : saison + pluie récente + humidité + température du sol ;
5. **réel terrain** : les sorties personnelles corrigent progressivement le score local.

Les observations positives renforcent un secteur. Les observations négatives sont volontairement beaucoup plus prudentes : elles ne pénalisent qu'en présence d'une fenêtre météo réellement favorable et après une prospection assez longue.

Le score reste un **indice de favorabilité**, pas une promesse de présence de champignons. Les pondérations sont explicables et séparées par espèce afin de pouvoir être recalibrées au fil des observations terrain.

## Données sols

Les attributs structurés sont récupérés à partir des couvertures WCS SoilGrids 2.0, à 250 m de résolution, sur l'horizon de surface 0–5 cm :

- `phh2o` : pH dans l'eau ;
- `sand`, `silt`, `clay` : fractions texturales ;
- `cfvo` : fragments grossiers ;
- `wv0033` : teneur en eau à la capacité au champ ;
- `wv1500` : teneur en eau au point de flétrissement.

La classe de texture est calculée à partir des fractions sable/limon/argile. Le **drainage est un indice inféré**, et non une mesure directe : il combine texture, fragments grossiers et réserve en eau. Si SoilGrids est temporairement indisponible, MycoMap garde le facteur sol neutre pour éviter de fabriquer une valeur.

## Sources principales

- Géoplateforme IGN WFS : `LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`
- Géoplateforme IGN altimétrie : ressource `ign_rge_alti_wld`
- Plan IGN WMTS : `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`
- Carte des sols INRAE / GIS Sol WMTS : `INRA.CARTE.SOLS`
- SoilGrids 2.0 / ISRIC WCS : pH, texture et propriétés hydriques à 250 m
- Open-Meteo : historique et conditions météo / sol

## Développement

```bash
npm install
npm run dev
```

Vérification :

```bash
npm run build
```

## Confidentialité

Les coordonnées des coins et sorties sont stockées dans `localStorage` sur l'appareil. Elles ne sont pas envoyées vers un serveur MycoMap. Les appels réseau servent uniquement aux données externes nécessaires au calcul (IGN, INRAE, ISRIC et météo).

## Suite prévue

- stockage IndexedDB des photos ;
- apprentissage non seulement local mais aussi par similarité d'habitat ;
- cache de terrain hors-ligne ;
- moteur de prévision de fenêtre de pousse par espèce ;
- calibration progressive des pondérations à partir des observations terrain réelles.
