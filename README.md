# MycoMap

MycoMap est une PWA mobile-first pour repérer les zones naturellement favorables aux champignons et construire une mémoire privée de terrain.

## V1

- carte plein écran MapLibre, pensée pour iPhone et usage à une main ;
- fond cartographique **Plan IGN** ;
- potentiel en couleurs : bleu → vert → jaune → orange → rouge (point chaud) ;
- moteurs réellement distincts pour **cèpes**, **girolles** et **morilles** ;
- **IGN BD Forêt v2** en WFS : polygones réels, code TFV, formation végétale et essence lorsqu'elle est fournie ;
- **IGN RGE ALTI** : altitude et calcul local de pente/exposition ;
- météo réelle avec fenêtres temporelles adaptées à chaque groupe : pluie récente et cumulée, température de l'air/du sol, humidité du sol, degrés-jours pour les girolles ;
- **SoilGrids 2.0 / ISRIC (250 m)** : pH, sable, limon, argile, fragments grossiers, capacité au champ et point de flétrissement ;
- classe de texture et indice de drainage calculés à partir des propriétés physiques du sol ;
- ajout d'une sortie positive ou négative ;
- une sortie négative ne dégrade réellement le modèle que si les conditions étaient favorables et l'effort de prospection significatif ;
- import d'une photo avec récupération de la position GPS EXIF et de la date ;
- historique privé et photos stockés localement ;
- cache spatial IndexedDB + cache de tuiles IGN pour les secteurs déjà consultés ;
- enregistrement de sorties/photos hors ligne puis enrichissement météo au retour du réseau ;
- PWA installable, thème clair/sombre/automatique et mise à jour automatique versionnée.

## Principe du score

Le score affiché combine :

1. **forêt / hôte** : type de formation et essence de la BD Forêt v2, avec un poids différent selon l'espèce recherchée ;
2. **sol** : pH + texture + drainage physique estimé depuis SoilGrids ;
3. **terrain** : altitude, pente et exposition calculées depuis le RGE ALTI ;
4. **phénologie + météo** : moteur distinct par champignon ;
5. **réel terrain** : les sorties personnelles corrigent progressivement le score local.

Le score est un **indice de potentiel 0–100**, pas un pourcentage de chance de récolte. Un habitat générique ne peut plus devenir rouge uniquement grâce à une météo favorable. La saison agit comme facteur limitant, particulièrement pour les morilles.

La justification scientifique des trois moteurs, les niveaux de preuve et les références sont documentés dans [`docs/SCIENTIFIC_MODEL.md`](docs/SCIENTIFIC_MODEL.md).

## Modèles par champignon

- **Cèpes** : hôte ectomycorhizien + eau disponible / humidité du sol + pluie en saison de fructification ; la fenêtre 20 j température / 26 j pluie issue d'un suivi récent sert seulement de raffinement secondaire tant qu'elle reste en prépublication.
- **Girolles** : hôtes ectomycorhiziens, sols plutôt acides et drainants, accumulation thermique et hydrique sur 6–13 semaines, plus pluie récente et température des semaines précédant la fructification.
- **Morilles** : forte fenêtre printanière, réchauffement du sol et événements de pluie des 30 jours précédents ; sol et végétation sont des indices plus prudents car l'écologie varie fortement selon les espèces et les perturbations.

## Données sols

Les attributs structurés sont récupérés à partir des couvertures WCS SoilGrids 2.0, à 250 m de résolution, sur l'horizon de surface 0–5 cm :

- `phh2o` : pH dans l'eau ;
- `sand`, `silt`, `clay` : fractions texturales ;
- `cfvo` : fragments grossiers ;
- `wv0033` : teneur en eau à la capacité au champ ;
- `wv1500` : teneur en eau au point de flétrissement.

La classe de texture est calculée à partir des fractions sable/limon/argile. Le **drainage est un indice inféré**, et non une mesure directe. Si SoilGrids est temporairement indisponible, MycoMap garde un facteur sol neutre au lieu de fabriquer une valeur.

## Sources de données

- Géoplateforme IGN WFS : `LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`
- Géoplateforme IGN altimétrie : ressource `ign_rge_alti_wld`
- Plan IGN WMTS : `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`
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

## Confidentialité et hors ligne

Les coordonnées et métadonnées des sorties restent sur l'appareil. Les photos sont conservées dans IndexedDB. MycoMap n'envoie pas les coins personnels vers un serveur applicatif. Les appels réseau servent uniquement à récupérer les données externes nécessaires au calcul.

Les zones déjà consultées restent disponibles hors ligne avec les dernières données mises en cache. Une observation enregistrée hors connexion modifie immédiatement la correction personnelle ; les informations météo manquantes sont complétées automatiquement lorsque le réseau revient.

## Suite prévue

- apprentissage par similarité d'habitat, en plus de la correction spatiale actuelle ;
- ajout d'une couche de perturbations/incendies utile aux morilles ;
- calibration quantitative du modèle à partir d'un historique suffisamment riche de sorties réelles ;
- export/import de sauvegarde des coins, observations et photos.
