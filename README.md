# MycoMap

MycoMap est une PWA mobile-first pour repérer les zones naturellement favorables aux champignons et construire une mémoire privée de terrain.

## V1

- carte plein écran MapLibre, pensée pour iPhone et usage à une main ;
- potentiel en couleurs : bleu → vert → jaune → orange → rouge (point chaud) ;
- moteurs distincts pour **cèpes**, **girolles** et **morilles** ;
- météo réelle : pluies 3/7/14/30 jours, température et humidité du sol ;
- altitude issue du modèle Copernicus via Open-Meteo ;
- zones forestières et essences lorsqu'elles sont renseignées dans OpenStreetMap ;
- ajout d'une sortie positive ou négative ;
- une sortie négative ne dégrade réellement le modèle que si les conditions étaient favorables et l'effort de prospection significatif ;
- import d'une photo avec récupération de la position GPS EXIF et de la date ;
- historique privé stocké localement sur l'appareil ;
- PWA installable, thème clair/sombre/automatique.

## Principe du score

Le score affiché combine actuellement :

1. **habitat** : forêt/essences + altitude ;
2. **moment** : saison + pluie récente + humidité + température du sol ;
3. **réel terrain** : les sorties personnelles corrigent progressivement le score local.

Les observations positives renforcent un secteur. Les observations négatives sont volontairement beaucoup plus prudentes : elles ne pénalisent qu'en présence d'une fenêtre météo réellement favorable et après une prospection assez longue.

## Données sols

La V1 ne simule pas de donnée pédologique absente. Le facteur sol reste volontairement neutre tant qu'une source française fiable (IGN / GIS Sol / autre service pérenne) n'est pas branchée. L'architecture garde ce fournisseur séparé afin de l'ajouter sans refaire le moteur.

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

Les coordonnées des coins et sorties sont stockées dans `localStorage` sur l'appareil. Elles ne sont pas envoyées vers un serveur MycoMap. Les appels réseau servent uniquement aux données externes nécessaires au calcul (carte, météo, altitude et forêt).

## Suite prévue

- fournisseur pédologique français ;
- limites réelles de parcelles forestières et données IGN plus fines ;
- stockage IndexedDB des photos ;
- apprentissage non seulement local mais aussi par similarité d'habitat ;
- cache de terrain hors-ligne ;
- moteur de prévision de fenêtre de pousse par espèce.
