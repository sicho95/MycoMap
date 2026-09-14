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
- couche nationale des sols **INRAE / GIS Sol** disponible en surimpression ;
- ajout d'une sortie positive ou négative ;
- une sortie négative ne dégrade réellement le modèle que si les conditions étaient favorables et l'effort de prospection significatif ;
- import d'une photo avec récupération de la position GPS EXIF et de la date ;
- historique privé stocké localement sur l'appareil ;
- PWA installable, thème clair/sombre/automatique.

## Principe du score

Le score affiché combine :

1. **forêt** : type de formation et essence de la BD Forêt v2, pondérés différemment selon l'espèce recherchée ;
2. **terrain** : altitude, pente et exposition calculées depuis le RGE ALTI ;
3. **moment** : saison + pluie récente + humidité + température du sol ;
4. **réel terrain** : les sorties personnelles corrigent progressivement le score local.

Les observations positives renforcent un secteur. Les observations négatives sont volontairement beaucoup plus prudentes : elles ne pénalisent qu'en présence d'une fenêtre météo réellement favorable et après une prospection assez longue.

Le score reste un **indice de favorabilité**, pas une promesse de présence de champignons. Les pondérations sont explicables et séparées par espèce afin de pouvoir être recalibrées au fil des observations terrain.

## Données sols

La carte nationale INRAE / GIS Sol est affichable directement dans MycoMap. Elle n'est pas encore transformée automatiquement en bonus/malus pédologique : MycoMap préfère laisser ce facteur neutre plutôt que de déduire artificiellement un pH depuis une couleur de tuile raster. Le prochain branchement devra exploiter des attributs pédologiques structurés (pH, texture, drainage ou classe de sol) avant de les intégrer au score.

## Sources principales

- Géoplateforme IGN WFS : `LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`
- Géoplateforme IGN altimétrie : ressource `ign_rge_alti_wld`
- Plan IGN WMTS : `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`
- Carte des sols WMTS : `INRA.CARTE.SOLS`
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

Les coordonnées des coins et sorties sont stockées dans `localStorage` sur l'appareil. Elles ne sont pas envoyées vers un serveur MycoMap. Les appels réseau servent uniquement aux données externes nécessaires au calcul (IGN, INRAE et météo).

## Suite prévue

- intégrer au score des attributs pédologiques structurés ;
- stockage IndexedDB des photos ;
- apprentissage non seulement local mais aussi par similarité d'habitat ;
- cache de terrain hors-ligne ;
- moteur de prévision de fenêtre de pousse par espèce.
